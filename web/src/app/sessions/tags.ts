// Tab labels: the repo a tab's shell is in, read from the daemon, and the tags
// checked in the tab's right-click menu (kept in this browser). A tagged tab
// shows its tags' colors, and the strip groups tabs by either (groups.ts).
import van from 'vanjs-core';
import { daemonFetch } from '../daemon/client.ts';
import { cleanTag, type Labels, parseTags, repoName, tagColor, toggleTag } from './labels.ts';
import { onActivate, type Session, store } from './store.ts';

const { div, i, input, label, span } = van.tags;

const TAGS_KEY = 'tabsh.tags';
const roots = new Map<string, string>(); // session id → project root
let menu: HTMLElement | null = null;

function storedTags(): Record<string, string[]> {
  try {
    return parseTags(JSON.parse(localStorage.getItem(TAGS_KEY) ?? '{}'));
  } catch {
    return {};
  }
}

export function setTags(s: Session, list: string[]): void {
  const tags = storedTags();
  if (list.length) tags[s.id] = list;
  else delete tags[s.id];
  try {
    localStorage.setItem(TAGS_KEY, JSON.stringify(tags));
  } catch {}
  render(s);
}

export const labelsOf = (s: Session): Labels => ({ repo: s.repo.val, tags: s.tags.val });

// Its tags, as stored, reach its tab (and its groups).
function render(s: Session): void {
  s.tags.val = storedTags()[s.id] ?? [];
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
    if (s.repo.val === name) return;
    s.repo.val = name;
  } catch {}
}

function closeMenu(): void {
  menu?.remove();
  menu = null;
}

// Opens a menu at (x, y): its left edge there, kept inside the window.
function showMenu(m: HTMLElement, x: number, y: number): void {
  closeMenu();
  m.style.top = `${y}px`;
  document.body.append(m);
  m.style.left = `${Math.max(8, Math.min(x, innerWidth - m.offsetWidth - 8))}px`;
  menu = m;
}

// A checkbox row, as Basecoat's label and checkbox: a tag gets its color's
// dot.
function checkRow(kind: 'repo' | 'tag', value: string, on: boolean, change: (on: boolean) => void): HTMLElement {
  const box = input({
    type: 'checkbox',
    class: 'input',
    checked: on,
    onchange: () => change(box.checked),
  });
  return label(
    { class: `label menu-check ${kind}` },
    box,
    i({ style: kind === 'tag' ? `background:${tagColor(value)}` : '' }),
    span(value),
  );
}

// The tab's right-click menu: a box to type a new tag, then a checkbox per tag
// in use, checked for the tab's own. A typed tag is added to the tab and the
// list, and the menu stays open.
function tagMenu(s: Session): HTMLElement {
  const list = div({ class: 'menu-list' });
  const fill = () => {
    const mine = storedTags()[s.id] ?? [];
    const used = [...new Set(Object.values(storedTags()).flat())].sort();
    list.replaceChildren(
      ...used.map((tag) =>
        checkRow('tag', tag, mine.includes(tag), (on) => setTags(s, toggleTag(storedTags()[s.id] ?? [], tag, on))),
      ),
    );
  };
  const field = input({
    type: 'text',
    class: 'input',
    placeholder: 'New tag…',
    maxLength: 24,
    'aria-label': 'New tag',
    onkeydown: (e: KeyboardEvent) => {
      const tag = e.key === 'Enter' && cleanTag(field.value);
      if (!tag) return;
      setTags(s, toggleTag(storedTags()[s.id] ?? [], tag, true));
      field.value = '';
      fill();
    },
  });
  fill();
  queueMicrotask(() => field.focus());
  return div({ class: 'row-menu tab-menu', role: 'dialog', 'aria-label': 'Tab tags' }, field, list);
}

// Tags a tab before it opens, so it lands in its tag's group.
export function adoptTag(id: string, tag: string): void {
  const all = storedTags();
  all[id] = [...new Set([...(all[id] ?? []), tag])];
  try {
    localStorage.setItem(TAGS_KEY, JSON.stringify(all));
  } catch {}
}

// A tab's right-click menu, at (x, y).
export function openTagMenu(s: Session, x: number, y: number): void {
  showMenu(tagMenu(s), x, y);
}

// Gives a new tab its labels.
export function labelTab(s: Session): void {
  render(s);
  void refreshRepo(s);
}

export function initTabLabels(): void {
  addEventListener('pointerdown', (e) => {
    const t = e.target as Node;
    if (menu && !menu.contains(t)) closeMenu();
  });
  addEventListener('keydown', (e) => e.key === 'Escape' && closeMenu());
  // The active tab's shell may `cd` into another repo: check it on a switch
  // and every few seconds.
  onActivate(() => {
    if (store.active) void refreshRepo(store.active);
  });
  setInterval(() => store.active && !document.hidden && refreshRepo(store.active), 3000);
}
