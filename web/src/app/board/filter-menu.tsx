// The board's filter: a query (`tag:bug -tag:wip`), the saved views it can
// come from, and the menu that edits both. The query and the views are kept
// in this browser; the views are shared by its open pages, the query isn't.
// Names and tags are user text: child strings and attribute values only.
import { createSignal, For, type JSX, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import { searchTags, tagColor } from '../sessions/labels.ts';
import { sessionList } from '../sessions/store.ts';
import { icons } from '../ui/icons.tsx';
import { foldersOf, shortPath, tagsInUse } from './model.ts';
import {
  completionAt,
  hasTerm,
  type Known,
  liveText,
  parseQuery,
  type QueryNode,
  suggestionsFor,
  withoutTerm,
  withTerm,
} from './query.ts';
import {
  addView,
  deleteView,
  nameTaken,
  newViewId,
  parseCurrent,
  parseViews,
  renameView,
  updateView,
  type View,
} from './views.ts';

const VIEWS_KEY = 'tabsh.boardViews';
const FILTER_KEY = 'tabsh.boardFilter';
// How long typing pauses before the board follows the query.
const TYPING_PAUSE_MS = 300;

function load<T>(key: string, parse: (raw: unknown) => T): T {
  try {
    return parse(JSON.parse(localStorage.getItem(key) ?? 'null'));
  } catch {
    return parse(null);
  }
}
function keep(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

const [views, setViews] = createSignal<View[]>(load(VIEWS_KEY, parseViews));
const initial = load(FILTER_KEY, parseCurrent);
// The applied query: always one that parses.
const [query, setQuery] = createSignal(parseQuery(initial.query).ok ? initial.query : '');
const [viewId, setViewId] = createSignal<string | null>(
  views().some((v) => v.id === initial.viewId) ? initial.viewId : null,
);
// The query field's text, which may be half typed or wrong.
const [draft, setDraft] = createSignal(query());
const [error, setError] = createSignal('');
const [open, setOpen] = createSignal(false);
let menu: HTMLElement | null = null;

function saveCurrent(): void {
  keep(FILTER_KEY, { query: query(), viewId: viewId() });
}
function saveViews(next: View[]): void {
  setViews(next);
  keep(VIEWS_KEY, next);
}

const activeView = (): View | null => views().find((v) => v.id === viewId()) ?? null;
// The active view's query has been edited since it was picked.
const modified = (): boolean => {
  const v = activeView();
  return !!v && v.query !== query();
};

// What the board is narrowed to: null shows every card.
export function filterNode(): QueryNode | null {
  const p = parseQuery(query());
  return p.ok ? p.node : null;
}
// Whether any filter is on.
export const filterOn = (): boolean => query().trim() !== '' || viewId() !== null;
export const boardViews = (): View[] => views();
export const activeViewId = (): string | null => viewId();

// Picks a view, or with null clears the filter.
export function applyView(id: string | null): void {
  const v = views().find((x) => x.id === id);
  setQuery(v && parseQuery(v.query).ok ? v.query : '');
  setViewId(v ? v.id : null);
  setDraft(query());
  setError('');
  saveCurrent();
}

// The tags and folders on the board now, for autocomplete and the checkboxes.
function inUse(): { tags: string[]; folders: string[] } {
  const items = sessionList().map((s) => ({ card: s.card(), tags: s.tags() }));
  return { tags: tagsInUse(items), folders: foldersOf(items) };
}
const known = (): Known => {
  const { tags, folders } = inUse();
  return { tags, folders: folders.map((f) => shortPath(f) || f) };
};

let pause = 0;
// Applies `text` if it parses; else says why under the field and leaves the
// board as it was.
function apply(text: string): void {
  window.clearTimeout(pause);
  const p = parseQuery(text);
  if (!p.ok) {
    setError(p.error.message);
    return;
  }
  setError('');
  setQuery(text.trim());
  saveCurrent();
}

export function closeFilterMenu(): void {
  window.clearTimeout(pause);
  menu = null;
  setOpen(false);
}
function openFilterMenu(): void {
  setDraft(query());
  setError('');
  setOpen(true);
}
const toggleMenu = (): void => (open() ? closeFilterMenu() : openFilterMenu());

function CheckRow(props: {
  text: string;
  checked: boolean;
  color: string | null;
  change: (checked: boolean) => void;
}): JSX.Element {
  const dot = props.color ? `background:${props.color}` : '';
  let box!: HTMLInputElement;
  return (
    <label class={`label menu-check${props.color ? '' : ' repo'}`}>
      <input
        ref={box}
        type="checkbox"
        class="input"
        checked={props.checked}
        on:change={() => props.change(box.checked)}
      />
      <i style={dot} />
      <span>{props.text}</span>
    </label>
  );
}

// A saved view: picking it applies it (or, when it's the active one, clears
// the filter); its ⋯ offers Rename and Delete.
function ViewRow(props: { view: View }): JSX.Element {
  const [actions, setActions] = createSignal(false);
  const [renaming, setRenaming] = createSignal(false);
  const [taken, setTaken] = createSignal(false);
  let field!: HTMLInputElement;
  const rename = (): void => {
    const next = renameView(views(), props.view.id, field.value);
    if (next === views() && field.value.trim() !== props.view.name) {
      setTaken(nameTaken(views(), field.value, props.view.id));
      return;
    }
    saveViews(next);
    setRenaming(false);
    setActions(false);
  };
  return (
    <div class="view-row">
      <Show
        when={renaming()}
        fallback={
          <>
            <button
              type="button"
              role="menuitemradio"
              class="view-pick"
              aria-checked={viewId() === props.view.id}
              title={props.view.query}
              onClick={() => applyView(viewId() === props.view.id ? null : props.view.id)}
            >
              <span class="view-tick">{viewId() === props.view.id ? icons.check() : null}</span>
              <span class="view-name">{props.view.name}</span>
            </button>
            <button
              type="button"
              class="btn view-more"
              data-variant="ghost"
              data-size="icon-sm"
              aria-label={`Options for ${props.view.name}`}
              aria-expanded={actions()}
              onClick={() => setActions(!actions())}
            >
              {icons.more()}
            </button>
          </>
        }
      >
        <input
          ref={(el) => {
            field = el;
            queueMicrotask(() => el.select());
          }}
          type="text"
          class="input"
          value={props.view.name}
          aria-label="Rename view"
          aria-invalid={taken()}
          on:input={() => setTaken(false)}
          on:keydown={(e) => {
            if (e.key === 'Enter') rename();
            if (e.key === 'Escape') {
              e.stopPropagation();
              setRenaming(false);
            }
          }}
        />
      </Show>
      <Show when={actions() && !renaming()}>
        <div class="view-actions">
          <button type="button" class="btn" data-variant="ghost" data-size="sm" onClick={() => setRenaming(true)}>
            Rename
          </button>
          <button
            type="button"
            class="btn"
            data-variant="ghost"
            data-size="sm"
            onClick={() => {
              saveViews(deleteView(views(), props.view.id));
              if (viewId() === props.view.id) {
                setViewId(null); // its query stays, unsaved
                saveCurrent();
              }
            }}
          >
            Delete
          </button>
        </div>
      </Show>
      <Show when={taken()}>
        <div class="menu-hint">A view already has that name</div>
      </Show>
    </div>
  );
}

// The open menu, on the page's body, under the Filter button.
function FilterMenu(): JSX.Element {
  const { tags, folders } = inUse();
  // Its search narrows the tags and folders listed, ignoring case.
  const [typed, setTyped] = createSignal('');
  const foundTags = () => searchTags(tags, typed());
  const foundFolders = () =>
    folders
      .map((folder) => ({ folder, name: shortPath(folder) || folder }))
      .filter((x) => searchTags([x.name], typed()).length);
  // Autocomplete: what's offered at the caret, the highlighted one (none, -1,
  // until an arrow key, so Enter applies what's typed), and whether Esc has
  // put the list away until the next keystroke.
  const [caret, setCaret] = createSignal(0);
  const [pick, setPick] = createSignal(-1);
  const [listed, setListed] = createSignal(true);
  const suggestions = () => {
    if (!listed()) return [];
    const c = completionAt(draft(), caret());
    return c ? suggestionsFor(c, known()) : [];
  };
  // Saving: the name field shows once Save as view is clicked.
  const [naming, setNaming] = createSignal(false);
  const [nameError, setNameError] = createSignal('');
  let field!: HTMLInputElement;
  let nameField!: HTMLInputElement;
  queueMicrotask(() => field.focus());

  const edit = (text: string, at: number, now = false): void => {
    field.value = text;
    field.setSelectionRange(at, at);
    setDraft(text);
    setCaret(at);
    setPick(-1);
    setListed(true);
    window.clearTimeout(pause);
    if (now) apply(text);
    else pause = window.setTimeout(() => apply(liveText(text, at, known())), TYPING_PAUSE_MS);
  };
  const choose = (insert: string): void => {
    const c = completionAt(draft(), caret());
    if (!c) return;
    const done = c.field !== null; // a value finishes the term
    const before = draft().slice(0, c.start) + insert + (done ? ' ' : '');
    const after = draft()
      .slice(c.end)
      .replace(/^ /, done ? '' : ' ');
    edit(before + after, before.length, done);
  };
  const tick = (field: 'tag' | 'folder', value: string, checked: boolean): void => {
    const next = checked ? withTerm(draft(), field, value) : withoutTerm(draft(), field, value);
    edit(next, next.length, true);
  };
  const save = (): void => {
    apply(draft());
    if (error()) return;
    const name = nameField.value;
    if (!name.trim()) return;
    if (nameTaken(views(), name)) {
      setNameError('A view already has that name');
      return;
    }
    const view = { id: newViewId(), name, query: query() };
    saveViews(addView(views(), view));
    setViewId(view.id);
    saveCurrent();
    setNaming(false);
  };

  return (
    <Portal
      ref={(host) => {
        const el = host.firstElementChild as HTMLElement;
        const r = (document.getElementById('board-filter-btn') as HTMLElement).getBoundingClientRect();
        el.style.top = `${r.bottom + 4}px`;
        el.style.left = `${Math.max(8, r.right - el.offsetWidth)}px`;
        menu = el;
      }}
    >
      <div class="row-menu tab-menu board-filter-menu" role="dialog" aria-label="Filter cards">
        <Show when={views().length}>
          <div class="menu-heading">Views</div>
          <div class="menu-list view-list" role="menu" aria-label="Saved views">
            <For each={views()}>{(view) => <ViewRow view={view} />}</For>
          </div>
          <div class="menu-sep" />
        </Show>
        <div class="query-box">
          <input
            ref={field}
            type="text"
            role="combobox"
            aria-controls="query-suggestions"
            class="input query-field"
            placeholder="tag:bug -tag:wip"
            autocomplete="off"
            spellcheck={false}
            aria-label="Filter query"
            aria-invalid={!!error()}
            aria-autocomplete="list"
            aria-expanded={suggestions().length > 0}
            value={draft()}
            on:input={() => edit(field.value, field.selectionStart ?? field.value.length)}
            on:click={() => setCaret(field.selectionStart ?? 0)}
            on:keyup={(e) => {
              if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End')
                setCaret(field.selectionStart ?? 0);
            }}
            on:keydown={(e) => {
              const list = suggestions();
              if (e.isComposing) return;
              if (list.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
                e.preventDefault();
                const from = pick() < 0 ? (e.key === 'ArrowDown' ? -1 : 0) : pick();
                const step = e.key === 'ArrowDown' ? 1 : -1;
                setPick((from + step + list.length) % list.length);
              } else if (list.length && (e.key === 'Tab' || (e.key === 'Enter' && pick() >= 0))) {
                e.preventDefault();
                choose(list[Math.min(Math.max(pick(), 0), list.length - 1)].insert);
              } else if (e.key === 'Enter') {
                apply(field.value);
              } else if (e.key === 'Escape' && list.length) {
                e.stopPropagation(); // the list goes first, the menu on the next Esc
                setListed(false);
              }
            }}
          />
          <Show when={suggestions().length}>
            <div class="query-suggestions" id="query-suggestions" role="listbox" aria-label="Suggestions">
              <For each={suggestions()}>
                {(s, i) => (
                  <div
                    role="option"
                    tabIndex={-1}
                    class="query-suggestion"
                    aria-selected={i() === pick()}
                    on:pointerdown={(e) => {
                      e.preventDefault(); // keep the field's focus
                      choose(s.insert);
                    }}
                  >
                    {s.label}
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>
        <Show when={error()}>
          <div class="query-error" role="alert">
            {error()}
          </div>
        </Show>
        <Show
          when={naming()}
          fallback={
            <div class="query-actions">
              <button
                type="button"
                class="btn"
                data-variant="outline"
                data-size="sm"
                disabled={!draft().trim()}
                onClick={() => {
                  setNameError('');
                  setNaming(true);
                  queueMicrotask(() => nameField.focus());
                }}
              >
                Save as view
              </button>
              <Show when={modified()}>
                <button
                  type="button"
                  class="btn"
                  data-variant="ghost"
                  data-size="sm"
                  onClick={() => saveViews(updateView(views(), viewId() as string, query()))}
                >
                  Update “{activeView()?.name}”
                </button>
              </Show>
            </div>
          }
        >
          <div class="query-actions">
            <input
              ref={nameField}
              type="text"
              class="input"
              placeholder="View name"
              aria-label="View name"
              aria-invalid={!!nameError()}
              on:input={() => setNameError('')}
              on:keydown={(e) => {
                if (e.key === 'Enter') save();
                if (e.key === 'Escape') {
                  e.stopPropagation();
                  setNaming(false);
                }
              }}
            />
            <button type="button" class="btn" data-size="sm" onClick={save}>
              Save
            </button>
          </div>
          <Show when={nameError()}>
            <div class="menu-hint">{nameError()}</div>
          </Show>
        </Show>
        <div class="menu-sep" />
        <input
          type="text"
          class="input"
          placeholder="Search tags and folders…"
          autocomplete="off"
          spellcheck={false}
          aria-label="Search tags and folders"
          on:input={(e) => setTyped(e.currentTarget.value)}
        />
        <Show when={foundTags().length}>
          <div class="menu-heading">Tags</div>
          <div class="menu-list">
            <For each={foundTags()}>
              {(tag) => (
                <CheckRow
                  text={tag}
                  checked={hasTerm(draft(), 'tag', tag)}
                  color={tagColor(tag)}
                  change={(checked) => tick('tag', tag, checked)}
                />
              )}
            </For>
          </div>
        </Show>
        <Show when={foundFolders().length}>
          <Show when={foundTags().length}>
            <div class="menu-sep" />
          </Show>
          <div class="menu-heading">Folders</div>
          <div class="menu-list">
            <For each={foundFolders()}>
              {({ name }) => (
                <CheckRow
                  text={name}
                  checked={hasTerm(draft(), 'folder', name)}
                  color={null}
                  change={(checked) => tick('folder', name, checked)}
                />
              )}
            </For>
          </div>
        </Show>
        <Show when={!foundTags().length && !foundFolders().length}>
          <div class="menu-hint">{tags.length || folders.length ? 'No matches' : 'No tags or folders yet'}</div>
        </Show>
      </div>
    </Portal>
  );
}

// The active view's name (or "Custom filter") while a filter is on, then the
// Filter button. Both open the menu. Shown only when `visible` says so.
export function FilterControls(props: { visible: boolean }): JSX.Element {
  return (
    <>
      <button
        type="button"
        class="btn view-chip"
        data-variant="ghost"
        data-size="sm"
        id="board-view-chip"
        title={query()}
        hidden={!(props.visible && filterOn())}
        onClick={toggleMenu}
      >
        {activeView()?.name ?? 'Custom filter'}
        <Show when={modified()}>
          <i class="modified" title="Edited since it was saved" />
        </Show>
      </button>
      <button
        type="button"
        class="btn"
        data-variant="ghost"
        data-size="icon-sm"
        aria-label="Filter"
        title="Filter"
        id="board-filter-btn"
        aria-expanded={open()}
        aria-pressed={filterOn()}
        hidden={!props.visible}
        onClick={toggleMenu}
      >
        {icons.listFilter()}
      </button>
      <Show when={open() && props.visible}>
        <FilterMenu />
      </Show>
    </>
  );
}

// A click outside the menu (and its buttons) or Esc closes it; views saved in
// another page show up here.
export function initFilter(): void {
  addEventListener('pointerdown', (e) => {
    const t = e.target as Node;
    const buttons = ['board-filter-btn', 'board-view-chip'].map((id) => document.getElementById(id));
    if (menu && !menu.contains(t) && !buttons.some((b) => b?.contains(t))) closeFilterMenu();
  });
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeFilterMenu();
  });
  addEventListener('storage', (e) => {
    if (e.key !== VIEWS_KEY && e.key !== null) return;
    setViews(load(VIEWS_KEY, parseViews));
    if (viewId() && !activeView()) {
      setViewId(null); // its view was deleted elsewhere: the query stays
      saveCurrent();
    }
  });
}
