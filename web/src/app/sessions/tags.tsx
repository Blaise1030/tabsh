// Tab labels: the repo a tab's shell is in, read from the daemon, and the tags
// checked in the tab's right-click menu (kept in this browser). A tagged tab
// shows its tags' colors, and the strip groups tabs by either (groups.tsx).
import { createSignal, For, type JSX, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { daemonFetch } from '../daemon/client.ts';
import { icons } from '../ui/icons.tsx';
import {
  exactTag,
  type Labels,
  parseTags,
  pickTyped,
  repoName,
  sameTags,
  searchTags,
  tagColor,
  toggleTag,
} from './labels.ts';
import { onActivate, type Session, store } from './store.ts';

const TAGS_KEY = 'tabsh.tags';
const roots = new Map<string, string>(); // session id → project root
let menu: { host: HTMLElement; dispose: () => void } | null = null;

function storedTags(): Record<string, string[]> {
  try {
    return parseTags(JSON.parse(localStorage.getItem(TAGS_KEY) ?? '{}'));
  } catch {
    return {};
  }
}

const tagListeners: (() => void)[] = [];
export function onTagsChange(fn: () => void): void {
  tagListeners.push(fn);
}

export function setTags(s: Session, list: string[]): void {
  const tags = storedTags();
  if (list.length) tags[s.id] = list;
  else delete tags[s.id];
  try {
    localStorage.setItem(TAGS_KEY, JSON.stringify(tags));
  } catch {}
  applyTags(s);
  for (const fn of tagListeners) fn();
}

// Every tag some tab has, sorted.
export const usedTags = (): string[] => [...new Set(Object.values(storedTags()).flat())].sort();

// A tag as a badge tinted in its color, after a dot of it. Static: it holds
// no reactive parts, so VanJS views may build it too.
export function tagBadge(tag: string, ...kids: (Node | string)[]): HTMLElement {
  const style = `--tag: ${tagColor(tag)}`;
  return (
    <span class="badge tag-badge" style={style}>
      <i />
      <span>{tag}</span>
      {kids}
    </span>
  ) as HTMLElement;
}

export const labelsOf = (s: Session): Labels => ({ repo: s.repo(), tags: s.tags() });

// Its tags, as stored, reach its tab (and its groups), when they changed.
function applyTags(s: Session, all = storedTags()): void {
  const tags = all[s.id] ?? [];
  if (!sameTags(tags, s.tags())) s.setTags(tags);
}

// The project root of a tab's shell, once read.
export const rootOf = (s: Session): string | null => roots.get(s.id) ?? null;

async function refreshRepo(s: Session): Promise<void> {
  try {
    const res = await daemonFetch(`/api/files/root?session=${encodeURIComponent(s.id)}`);
    if (!res.ok) return;
    const { root } = (await res.json()) as { root: string };
    const name = repoName(root);
    roots.set(s.id, root);
    if (s.repo() === name) return;
    s.setRepo(name);
  } catch {}
}

function closeMenu(): void {
  if (!menu) return;
  menu.dispose();
  menu.host.remove();
  menu = null;
}

// A checkbox row, as Basecoat's label and checkbox: a tag gets its color's
// dot.
function CheckRow(props: {
  kind: 'repo' | 'tag';
  value: string;
  on: boolean;
  change: (on: boolean) => void;
}): JSX.Element {
  const dot = props.kind === 'tag' ? `background:${tagColor(props.value)}` : '';
  let box!: HTMLInputElement;
  return (
    <label class={`label menu-check ${props.kind}`}>
      <input ref={box} type="checkbox" class="input" checked={props.on} on:change={() => props.change(box.checked)} />
      <i style={dot} />
      <span>{props.value}</span>
    </label>
  );
}

// A tag search's field and its last row, which makes the tag typed while it
// names none in use. A tags panel and a tab's menu share them.
export const SEARCH_TAGS = 'Search or create tag…';
export function CreateTagRow(props: { typed: string; make: () => void }): JSX.Element {
  return (
    <button
      type="button"
      class="tags-create"
      tabindex="-1"
      // As a tag row: a press mustn't move focus, which a chip's popover
      // would take for leaving it.
      on:mousedown={(e) => e.preventDefault()}
      on:click={() => props.make()}
    >
      {icons.plus()}
      <span>Create “{props.typed.trim()}”</span>
    </button>
  );
}

// The tab's right-click menu: a box to search the tags in use or type a new
// one, then a checkbox per tag it finds, checked for the tab's own. Enter
// ticks the tag typed, making it when it's new, and the menu stays open.
function TagMenu(props: { session: Session }): JSX.Element {
  const s = props.session;
  // Bumped to read the stored tags again, once a typed one is added.
  const [read, reread] = createSignal(0);
  const [typed, setTyped] = createSignal('');
  const tags = () => {
    read();
    return usedTags();
  };
  const mine = () => {
    read();
    return storedTags()[s.id] ?? [];
  };
  let field!: HTMLInputElement;
  const pick = () => {
    if (!field.value.trim()) return;
    setTags(s, pickTyped(storedTags()[s.id] ?? [], usedTags(), field.value));
    field.value = '';
    setTyped('');
    reread((n) => n + 1);
    field.focus();
  };
  queueMicrotask(() => field.focus());
  return (
    <>
      <input
        ref={field}
        type="text"
        class="input"
        placeholder={SEARCH_TAGS}
        maxLength={24}
        autocomplete="off"
        aria-label="Search or create tag"
        on:input={() => setTyped(field.value)}
        on:keydown={(e) => {
          if (e.key !== 'Enter' || e.isComposing) return;
          e.preventDefault();
          pick();
        }}
      />
      <div class="menu-list">
        <For each={searchTags(tags(), typed())}>
          {(tag) => (
            <CheckRow
              kind="tag"
              value={tag}
              on={mine().includes(tag)}
              change={(on) => setTags(s, toggleTag(storedTags()[s.id] ?? [], tag, on))}
            />
          )}
        </For>
        <Show when={typed().trim() && !exactTag(tags(), typed())}>
          <CreateTagRow typed={typed()} make={pick} />
        </Show>
      </div>
    </>
  );
}

// Tags a tab before it opens, so it lands in its tag's group (or, when a
// sync opened it first, moves it there).
export function adoptTag(id: string, tag: string): void {
  const all = storedTags();
  all[id] = [...new Set([...(all[id] ?? []), tag])];
  try {
    localStorage.setItem(TAGS_KEY, JSON.stringify(all));
  } catch {}
  const open = store.sessions.find((s) => s.id === id);
  if (open) applyTags(open);
}

// A tab's right-click menu, at (x, y): its left edge there, kept inside the
// window. The menu is its own host on the page's body.
export function openTagMenu(s: Session, x: number, y: number): void {
  closeMenu();
  const host = document.createElement('div');
  host.className = 'row-menu tab-menu';
  host.setAttribute('role', 'dialog');
  host.setAttribute('aria-label', 'Tab tags');
  host.style.top = `${y}px`;
  document.body.append(host);
  const dispose = render(() => <TagMenu session={s} />, host);
  host.style.left = `${Math.max(8, Math.min(x, innerWidth - host.offsetWidth - 8))}px`;
  menu = { host, dispose };
}

// Gives a new tab its labels.
export function labelTab(s: Session): void {
  applyTags(s);
  void refreshRepo(s);
}

export function initTabLabels(): void {
  addEventListener('pointerdown', (e) => {
    const t = e.target as Node;
    if (menu && !menu.host.contains(t)) closeMenu();
  });
  addEventListener('keydown', (e) => e.key === 'Escape' && closeMenu());
  // Tags changed in another window of this browser reach these tabs.
  addEventListener('storage', (e) => {
    if (e.key !== TAGS_KEY && e.key !== null) return;
    const all = storedTags();
    for (const s of store.sessions) applyTags(s, all);
  });
  // The active tab's shell may `cd` into another repo: check it on a switch
  // and every few seconds.
  onActivate(() => {
    if (store.active) void refreshRepo(store.active);
  });
  setInterval(() => store.active && !document.hidden && refreshRepo(store.active), 3000);
}
