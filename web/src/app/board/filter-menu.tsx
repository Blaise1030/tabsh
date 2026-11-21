// The board's filter: a query (`tag:bug -tag:wip`), the saved views it can
// come from, and the menu that edits both. The query and the views are kept
// in this browser; the views are shared by its open pages, the query isn't.
// Names and tags are user text: child strings and attribute values only.
import { createSignal, For, type JSX, Show } from 'solid-js';
import { Portal } from 'solid-js/web';
import { tagColor } from '../sessions/labels.ts';
import { sessionList } from '../sessions/store.ts';
import { icons } from '../ui/icons.tsx';
import { STATUS_NAMES } from './glyph.ts';
import { folderName, foldersOf, STATUSES, shortPath, tagsInUse } from './model.ts';
import {
  addTerm,
  completionAt,
  dropTerm,
  formatTerm,
  type Known,
  liveText,
  mentions,
  migrateFilter,
  parseQuery,
  type QueryNode,
  suggestionsFor,
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

const STATUS_LIST = STATUSES.map((st) => STATUS_NAMES[st]);
// The list's section names, one over each kind of row.
const HEADINGS: Record<string, string> = { field: 'Fields', tag: 'Tags', folder: 'Folders', status: 'Status' };
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
// The tags and folders ticked (folders as `shortPath` shows them): a quick
// filter of its own, on top of any view, never written into its query.
const [tickTags, setTickTags] = createSignal<string[]>(initial.tags);
const [tickFolders, setTickFolders] = createSignal<string[]>(initial.folders.map((f) => shortPath(f) || f));
// The ticks as the query that means the same: any ticked tag, any ticked folder.
const tickQuery = (): string => migrateFilter({ tags: tickTags(), folders: tickFolders() });
const ticked = (): number => tickTags().length + tickFolders().length;
// The query field's text, which may be half typed or wrong.
const [draft, setDraft] = createSignal(query());
const [error, setError] = createSignal('');
const [open, setOpen] = createSignal(false);
let menu: HTMLElement | null = null;

function saveCurrent(): void {
  keep(FILTER_KEY, { query: query(), viewId: viewId(), tags: tickTags(), folders: tickFolders() });
}
function saveViews(next: View[]): void {
  setViews(next);
  keep(VIEWS_KEY, next);
}

const activeView = (): View | null => views().find((v) => v.id === viewId()) ?? null;
// The chip: the view's name (or Custom filter, for an unsaved query), then
// what's ticked.
const chipLabel = (): string => {
  const head = activeView()?.name ?? (query().trim() ? 'Custom filter' : '');
  const ticks = [...tickTags(), ...tickFolders().map((f) => folderName(f) || f)];
  const tail = ticks.length > 2 ? `${ticks.length} filters` : ticks.join(', ');
  return [head, tail].filter(Boolean).join(' · ');
};
// The active view's query has been edited since it was picked.
const modified = (): boolean => {
  const v = activeView();
  return !!v && v.query !== query();
};

// What the board is narrowed to: null shows every card.
// A card must match both the view's query and the ticks.
export function filterNode(): QueryNode | null {
  const parts = [query(), tickQuery()].filter((q) => q.trim());
  const p = parseQuery(parts.map((q) => `(${q})`).join(' and '));
  return p.ok ? p.node : null;
}
// Whether any filter is on.
export const filterOn = (): boolean => query().trim() !== '' || viewId() !== null || ticked() > 0;
function setTicks(tags: string[], folders: string[]): void {
  setTickTags(tags);
  setTickFolders(folders);
  saveCurrent();
}
// Clears the view, its query and the ticks.
function clearAll(): void {
  applyView(null);
  setTicks([], []);
}
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

// A short message at the bottom of the page: what's wrong with the query or
// the name, when Enter or Save meets it.
const [toastText, setToastText] = createSignal('');
let toastTimer = 0;
function showToast(text: string): void {
  window.clearTimeout(toastTimer);
  setToastText(text);
  toastTimer = window.setTimeout(() => setToastText(''), 3500);
}

let pause = 0;
// Applies `text` if it parses; else marks the field and leaves the board as
// it was, saying why in a toast when `loud` (Enter, Save).
function apply(text: string, loud = false): void {
  window.clearTimeout(pause);
  const p = parseQuery(text);
  if (!p.ok) {
    setError(p.error.message);
    if (loud) showToast(p.error.message);
    return;
  }
  setError('');
  setQuery(text.trim());
  saveCurrent();
}

// The menu shows the saved views; the query editor opens only for New view or
// a view's Edit. `editing` is the view being edited (null: a new one).
const [mode, setMode] = createSignal<'views' | 'edit'>('views');
const [editing, setEditing] = createSignal<string | null>(null);
// The filter as it was when the editor opened, for Cancel; and whether the
// editor is turning the ticks into a view (they're cleared once it's saved).
let before = { query: '', viewId: null as string | null, tags: [] as string[], folders: [] as string[] };
let fromTicks = false;

export function closeFilterMenu(): void {
  window.clearTimeout(pause);
  menu = null;
  setOpen(false);
}
function openFilterMenu(): void {
  setDraft(query());
  setError('');
  setMode('views');
  setOpen(true);
}
const toggleMenu = (): void => (open() ? closeFilterMenu() : openFilterMenu());

// Opens the editor on a view (applied, so the board shows it), or on a new
// one starting from the unsaved filter, if any.
// With `ticks`, a new view starts from the ticked tags and folders. While the
// editor is open the ticks step aside, so the board shows the view alone.
function startEdit(id: string | null, ticks = false): void {
  before = { query: query(), viewId: viewId(), tags: tickTags(), folders: tickFolders() };
  fromTicks = ticks && !id;
  if (id) applyView(id);
  else if (fromTicks) {
    setViewId(null);
    // Ticks of one kind need no brackets: `tag:a or tag:b`.
    const one = !tickTags().length || !tickFolders().length;
    setQuery(one ? tickQuery().replace(/^\((.*)\)$/, '$1') : tickQuery());
  } else if (viewId()) applyView(null);
  setTickTags([]);
  setTickFolders([]);
  setEditing(id);
  setDraft(query());
  setError('');
  setMode('edit');
}
function cancelEdit(): void {
  window.clearTimeout(pause);
  setQuery(before.query);
  setViewId(before.viewId);
  setTicks(before.tags, before.folders);
  setError('');
  setMode('views');
}
// After Save: ticks that became the view stay cleared; others come back.
function finishEdit(): void {
  if (!fromTicks) setTicks(before.tags, before.folders);
  else saveCurrent();
  setMode('views');
}

// One row of the editor's list: a value to add, or a tag or folder to tick.
interface Item {
  key: string;
  label: string;
  kind: string;
  title?: string;
  color?: string;
  checked?: boolean;
  run: () => void;
}

// A folder as the list shows it: its own name; the path is its tooltip.
const folderLabel = (f: string): string => folderName(f) || f;

// The tags and folders on the board, each a tick box that adds or drops its
// term in the applied filter at once (a picked view then shows as edited).
// A search narrows them once there are more than a few.
function QuickTicks(): JSX.Element {
  const k = known();
  const [typed, setTyped] = createSignal('');
  const match = (x: string): boolean => x.toLowerCase().includes(typed().trim().toLowerCase());
  const flip = (list: string[], value: string): string[] =>
    list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
  const tags = () => k.tags.filter(match);
  const folders = () => k.folders.filter((f) => match(f));
  return (
    <>
      <div class="fm-sep" />
      <Show when={k.tags.length + k.folders.length > 8}>
        <input
          type="text"
          class="fm-search"
          placeholder="Search tags and folders…"
          aria-label="Search tags and folders"
          autocomplete="off"
          spellcheck={false}
          on:input={(e) => setTyped(e.currentTarget.value)}
        />
      </Show>
      <div class="fm-list">
        <div class="fm-heading">Tags</div>
        <Show
          when={tags().length}
          fallback={
            <div class="fm-empty">
              {k.tags.length ? 'No matching tags' : "No tags yet. Add them from a card's ⋯ menu."}
            </div>
          }
        >
          <For each={tags()}>
            {(t) => (
              <TickRow
                label={t}
                color={tagColor(t)}
                checked={tickTags().includes(t)}
                pick={() => setTicks(flip(tickTags(), t), tickFolders())}
              />
            )}
          </For>
        </Show>
        <div class="fm-heading">Folders</div>
        <Show
          when={folders().length}
          fallback={<div class="fm-empty">{k.folders.length ? 'No matching folders' : 'No folders yet'}</div>}
        >
          <For each={folders()}>
            {(f) => (
              <TickRow
                label={folderLabel(f)}
                title={f}
                checked={tickFolders().includes(f)}
                pick={() => setTicks(tickTags(), flip(tickFolders(), f))}
              />
            )}
          </For>
        </Show>
      </div>
      <Show when={ticked()}>
        <button type="button" class="fm-link fm-save-ticks" onClick={() => startEdit(null, true)}>
          {icons.plus()}
          <span>Save these as a view</span>
        </button>
      </Show>
    </>
  );
}

function TickRow(props: { label: string; title?: string; color?: string; checked: boolean; pick: () => void }) {
  return (
    <button type="button" class="fm-row" aria-pressed={props.checked} title={props.title} onClick={props.pick}>
      <span class="fm-box" data-checked={props.checked ? '' : undefined}>
        {props.checked ? icons.check() : null}
      </span>
      <Show when={props.color}>
        <i class="fm-dot" style={`background:${props.color}`} />
      </Show>
      <span class="fm-name">{props.label}</span>
    </button>
  );
}

function ViewsPane(): JSX.Element {
  return (
    <>
      <div class="fm-heading">Views</div>
      <Show when={views().length} fallback={<div class="fm-empty">No saved views yet</div>}>
        <div class="fm-views" role="menu" aria-label="Saved views">
          <For each={views()}>
            {(v) => (
              <div class="fm-view-row">
                <button
                  type="button"
                  role="menuitemradio"
                  class="fm-view"
                  aria-checked={viewId() === v.id}
                  onClick={() => applyView(viewId() === v.id ? null : v.id)}
                >
                  <span class="fm-check">{viewId() === v.id ? icons.check() : null}</span>
                  <span class="fm-name">{v.name}</span>
                  <span class="fm-query">{v.query}</span>
                </button>
                <button
                  type="button"
                  class="btn fm-icon"
                  data-variant="ghost"
                  data-size="icon-sm"
                  aria-label={`Edit ${v.name}`}
                  title="Edit"
                  onClick={() => startEdit(v.id)}
                >
                  {icons.edit()}
                </button>
              </div>
            )}
          </For>
        </div>
      </Show>
      <Show when={query() && !viewId()}>
        <div class="fm-view-row fm-custom">
          <div class="fm-view">
            <span class="fm-check">{icons.check()}</span>
            <span class="fm-name">Custom filter</span>
            <span class="fm-query">{query()}</span>
          </div>
          <button
            type="button"
            class="btn fm-icon"
            data-variant="ghost"
            data-size="icon-sm"
            aria-label="Save as a view"
            title="Save as a view"
            onClick={() => startEdit(null)}
          >
            {icons.edit()}
          </button>
        </div>
      </Show>
      <QuickTicks />
      <div class="fm-foot">
        <button type="button" class="fm-link" onClick={() => startEdit(null)}>
          {icons.plus()}
          <span>New view</span>
        </button>
        <Show when={filterOn()}>
          <button type="button" class="fm-link fm-muted" onClick={clearAll}>
            Clear filter
          </button>
        </Show>
      </div>
    </>
  );
}

function EditPane(): JSX.Element {
  const view = views().find((v) => v.id === editing()) ?? null;
  const [caret, setCaret] = createSignal(draft().length);
  // The highlighted row: none (-1) until an arrow key, so Enter applies.
  const [pick, setPick] = createSignal(-1);
  const [nameBad, setNameBad] = createSignal(false);
  // Which values the list offers to tick: all, or one field's (its button).
  const [scope, setScope] = createSignal<'all' | 'tag' | 'folder' | 'status'>('all');
  let field!: HTMLInputElement;
  let nameField!: HTMLInputElement;
  queueMicrotask(() => (view ? field : nameField).focus());

  const edit = (text: string, at: number, now = false): void => {
    field.value = text;
    field.setSelectionRange(at, at);
    setDraft(text);
    setCaret(at);
    setPick(-1);
    window.clearTimeout(pause);
    if (now) apply(text);
    else pause = window.setTimeout(() => apply(liveText(text, at, known())), TYPING_PAUSE_MS);
  };
  // Puts `text` at the caret (over a selection), spaced from its neighbours.
  const insert = (text: string, opts: { space?: boolean } = {}): void => {
    const from = field.selectionStart ?? draft().length;
    const to = field.selectionEnd ?? from;
    const before = draft().slice(0, from);
    const gap = before && !/[\s(-]$/.test(before) ? ' ' : '';
    const head = before + gap + text + (opts.space ? ' ' : '');
    edit(head + draft().slice(to), head.length);
    field.focus();
  };
  const choose = (replacement: string, done: boolean): void => {
    const c = completionAt(draft(), caret());
    if (!c) return;
    const head = draft().slice(0, c.start) + replacement + (done ? ' ' : '');
    const tail = draft()
      .slice(c.end)
      .replace(/^ /, done ? '' : ' ');
    edit(head + tail, head.length, done);
    field.focus();
  };
  const toggle = (kind: 'tag' | 'folder' | 'status', value: string, on: boolean): void => {
    const next = on ? addTerm(draft(), kind, value) : dropTerm(draft(), kind, value);
    edit(next, next.length, true);
    field.focus();
  };

  // What the list offers at the caret: values for the field being typed;
  // fields, tags and folders for a bare word; else every tag and folder to
  // tick, and the statuses.
  const items = (): Item[] => {
    const k = known();
    const c = completionAt(draft(), caret());
    const offered = c ? suggestionsFor(c, k) : [];
    if (c?.field && offered.length) {
      const kind = c.field;
      return offered.map((x) => ({
        key: `${kind}:${x.label}`,
        label: x.label,
        kind,
        color: kind === 'tag' ? tagColor(x.label) : undefined,
        checked: false,
        run: () => choose(x.insert, true),
      }));
    }
    if (c && !c.field) {
      const typed = c.partial.toLowerCase();
      const fields = offered.map((x) => ({
        key: `field:${x.label}`,
        label: x.label,
        kind: 'field',
        run: () => choose(x.insert, false),
      }));
      const tags = k.tags
        .filter((t) => t.toLowerCase().includes(typed))
        .map((t) => ({
          key: `tag:${t}`,
          label: t,
          kind: 'tag',
          color: tagColor(t),
          run: () => choose(formatTerm('tag', t), true),
        }));
      const folders = k.folders
        .filter((f) => f.toLowerCase().includes(typed))
        .map((f) => ({
          key: `folder:${f}`,
          label: f,
          kind: 'folder',
          run: () => choose(formatTerm('folder', f), true),
        }));
      const found = [...fields, ...tags, ...folders].slice(0, 12);
      if (found.length) return found;
    }
    // A finished value, or nothing at the caret: the values to tick, all or
    // the chosen field's.
    const box = (kind: 'tag' | 'folder' | 'status', value: string, color?: string): Item => {
      const checked = mentions(draft(), kind, value);
      const label = kind === 'folder' ? folderLabel(value) : value;
      return {
        key: `${kind}:${value}`,
        label,
        title: value,
        kind,
        color,
        checked,
        run: () => toggle(kind, value, !checked),
      };
    };
    const sc = scope();
    return [
      ...(sc === 'all' || sc === 'tag' ? k.tags.map((t) => box('tag', t, tagColor(t))) : []),
      ...(sc === 'all' || sc === 'folder' ? k.folders.map((f) => box('folder', f)) : []),
      ...(sc === 'all' || sc === 'status' ? STATUS_LIST.map((st) => box('status', st)) : []),
    ];
  };

  const save = (): void => {
    apply(draft(), true);
    if (error()) return;
    const name = nameField.value.trim();
    const id = editing();
    const problem = !name
      ? 'Give the view a name'
      : nameTaken(views(), name, id ?? undefined)
        ? 'A view already has that name'
        : '';
    if (problem) {
      setNameBad(true);
      showToast(problem);
      nameField.focus();
      return;
    }
    if (id) {
      saveViews(updateView(renameView(views(), id, name), id, query()));
      setViewId(id);
    } else {
      const v = { id: newViewId(), name, query: query() };
      saveViews(addView(views(), v));
      setViewId(v.id);
    }
    finishEdit();
  };
  const remove = (): void => {
    const id = editing();
    if (!id) return;
    saveViews(deleteView(views(), id));
    setViewId(null); // its query stays on the board, unsaved
    finishEdit();
  };

  return (
    <>
      <div class="fm-head">
        <button
          type="button"
          class="btn fm-icon"
          data-variant="ghost"
          data-size="icon-sm"
          aria-label="Back to views"
          title="Back"
          onClick={cancelEdit}
        >
          {icons.back()}
        </button>
        <input
          ref={nameField}
          type="text"
          class="fm-name-field"
          placeholder="View name"
          aria-label="View name"
          aria-invalid={nameBad()}
          value={view?.name ?? ''}
          autocomplete="off"
          on:input={() => setNameBad(false)}
          on:keydown={(e) => {
            if (e.key === 'Enter') save();
          }}
        />
      </div>
      <input
        ref={field}
        type="text"
        role="combobox"
        aria-controls="fm-list"
        aria-expanded={items().length > 0}
        aria-autocomplete="list"
        class="fm-query-field"
        placeholder="tag:bug and -tag:wip"
        autocomplete="off"
        spellcheck={false}
        aria-label="Filter query"
        aria-invalid={!!error()}
        value={draft()}
        on:input={() => edit(field.value, field.selectionStart ?? field.value.length)}
        on:click={() => setCaret(field.selectionStart ?? 0)}
        on:select={() => setCaret(field.selectionStart ?? 0)}
        on:keyup={(e) => {
          if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) setCaret(field.selectionStart ?? 0);
        }}
        on:keydown={(e) => {
          const list = items();
          if (e.isComposing) return;
          if (list.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            e.preventDefault();
            const from = pick() < 0 ? (e.key === 'ArrowDown' ? -1 : 0) : pick();
            setPick((from + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length);
          } else if (list.length && e.key === 'Enter' && pick() >= 0) {
            e.preventDefault();
            list[Math.min(pick(), list.length - 1)].run();
          } else if (e.key === 'Tab' && completionAt(draft(), caret()) && list.length) {
            e.preventDefault();
            list[Math.max(pick(), 0)].run();
          } else if (e.key === 'Enter') {
            if (e.metaKey || e.ctrlKey) save();
            else apply(field.value, true);
          }
        }}
      />
      <div class="fm-ops" role="toolbar" aria-label="Insert into the query">
        <button type="button" class="fm-op" title="Both must match" onClick={() => insert('and', { space: true })}>
          and
        </button>
        <button type="button" class="fm-op" title="Either can match" onClick={() => insert('or', { space: true })}>
          or
        </button>
        <button type="button" class="fm-op" title="Not" onClick={() => insert('-')}>
          not
        </button>
        <span class="fm-op-gap" />
        <button
          type="button"
          class="fm-op"
          aria-pressed={scope() === 'tag'}
          title="Show only tags to tick"
          onClick={() => {
            setScope(scope() === 'tag' ? 'all' : 'tag');
            field.focus();
          }}
        >
          tag
        </button>
        <button
          type="button"
          class="fm-op"
          aria-pressed={scope() === 'folder'}
          title="Show only folders to tick"
          onClick={() => {
            setScope(scope() === 'folder' ? 'all' : 'folder');
            field.focus();
          }}
        >
          folder
        </button>
        <button
          type="button"
          class="fm-op"
          aria-pressed={scope() === 'status'}
          title="Show only statuss to tick"
          onClick={() => {
            setScope(scope() === 'status' ? 'all' : 'status');
            field.focus();
          }}
        >
          status
        </button>
      </div>
      <div class="fm-list" id="fm-list" role="listbox" aria-label="Suggestions">
        <For each={items()} fallback={<div class="fm-empty">Nothing matches</div>}>
          {(it, i) => (
            <>
              <Show when={i() === 0 || items()[i() - 1]?.kind !== it.kind}>
                <div class="fm-heading">{HEADINGS[it.kind] ?? it.kind}</div>
              </Show>
              <div
                role="option"
                tabIndex={-1}
                class="fm-row"
                title={it.title}
                aria-selected={i() === pick()}
                on:pointerdown={(e) => {
                  e.preventDefault(); // keep the field's focus
                  it.run();
                }}
              >
                <Show when={it.kind !== 'field'}>
                  <span class="fm-box" data-checked={it.checked ? '' : undefined}>
                    {it.checked ? icons.check() : null}
                  </span>
                </Show>
                <Show when={it.color}>
                  <i class="fm-dot" style={`background:${it.color}`} />
                </Show>
                <span class="fm-name">{it.label}</span>
              </div>
            </>
          )}
        </For>
      </div>
      <div class="fm-foot">
        <Show when={view}>
          <button
            type="button"
            class="btn fm-delete"
            data-variant="ghost"
            data-size="sm"
            title="Delete this view"
            onClick={remove}
          >
            {icons.trash()}
            <span>Delete</span>
          </button>
        </Show>
        <span class="fm-spacer" />
        <button type="button" class="btn" data-variant="ghost" data-size="sm" onClick={cancelEdit}>
          Cancel
        </button>
        <button type="button" class="btn" data-size="sm" onClick={save}>
          {view ? 'Save' : 'Save view'}
        </button>
      </div>
    </>
  );
}

// The open menu, on the page's body, under the Filter button.
function FilterMenu(): JSX.Element {
  return (
    <Portal
      ref={(host) => {
        const el = host.firstElementChild as HTMLElement;
        const r = (document.getElementById('board-filter-btn') as HTMLElement).getBoundingClientRect();
        el.style.top = `${r.bottom + 6}px`;
        el.style.right = `${Math.max(8, window.innerWidth - r.right)}px`;
        menu = el;
      }}
    >
      <div class="row-menu tab-menu board-filter-menu" role="dialog" aria-label="Filter cards">
        <Show when={mode() === 'edit'} fallback={<ViewsPane />}>
          <EditPane />
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
        {chipLabel()}
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
      <Show when={toastText()}>
        <Portal>
          <div class="fm-toast" role="status">
            {icons.circleX()}
            <span>{toastText()}</span>
          </div>
        </Portal>
      </Show>
    </>
  );
}

// A click outside the menu (and its buttons) or Esc closes it; views saved in
// another page show up here.
export function initFilter(): void {
  addEventListener('pointerdown', (e) => {
    // The path as dispatched: a row the click redraws is gone from the menu
    // by now, but was inside it.
    const path = e.composedPath();
    const buttons = ['board-filter-btn', 'board-view-chip'].map((id) => document.getElementById(id));
    if (menu && !path.includes(menu) && !buttons.some((b) => b && path.includes(b))) closeFilterMenu();
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
