// Tab labels: the repo a tab's shell is in, read from the daemon, and the tags
// checked in the tab's right-click menu (kept in this browser). A tagged tab
// shows its tags' colors; the palette's filter page (the filter button beside
// settings, or its shortcut) shows only the tabs under the one repo or tag
// picked there, previewing each while it is highlighted. The picked filter is
// kept in this browser too, and a tab opened under it joins it.
import { daemonFetch } from '../daemon/client.ts';
import { el } from '../ui/dom.ts';
import {
  cleanTag,
  filterKey,
  filterOptions,
  isSingleFilter,
  type Labels,
  matches,
  newTabLabels,
  parseChecked,
  parseTags,
  repoName,
  tagBar,
  tagColor,
  toggleTag,
} from './labels.ts';
import { onActivate, type Session, store } from './store.ts';
import { updateFades } from './tabs.ts';

const TAGS_KEY = 'tabsh.tags';
const FILTER_KEY = 'tabsh.filter';
const repos = new Map<string, string>(); // session id → repo label
const roots = new Map<string, string>(); // session id → project root
const looked = new Set<string>(); // session ids whose repo has been asked for
const checked = new Set<string>(); // the filter's keys (at most one)
const committed = new Set<string>(); // the picked filter the palette reverts to
let menu: HTMLElement | null = null;

const filterButton = () => document.getElementById('tab-filter-btn') as HTMLButtonElement;

function storedTags(): Record<string, string[]> {
  try {
    return parseTags(JSON.parse(localStorage.getItem(TAGS_KEY) ?? '{}'));
  } catch {
    return {};
  }
}

function setTags(s: Session, list: string[]): void {
  const tags = storedTags();
  if (list.length) tags[s.id] = list;
  else delete tags[s.id];
  try {
    localStorage.setItem(TAGS_KEY, JSON.stringify(tags));
  } catch {}
  render(s);
}

// The picked filter is what survives a reload; a preview never is.
function saveChecked(): void {
  try {
    localStorage.setItem(FILTER_KEY, JSON.stringify([...committed]));
  } catch {}
}

function loadChecked(): void {
  try {
    const kept = parseChecked(JSON.parse(localStorage.getItem(FILTER_KEY) ?? '[]'));
    checked.clear();
    committed.clear();
    for (const k of kept) {
      checked.add(k);
      committed.add(k);
    }
  } catch {}
}

const labelsOf = (s: Session): Labels => ({ repo: repos.get(s.id) ?? null, tags: storedTags()[s.id] ?? [] });

// A tagged tab shows a bar in its tags' colors.
function render(s: Session): void {
  const { tags } = labelsOf(s);
  s.tab.classList.toggle('tagged', tags.length > 0);
  if (tags.length) s.tab.style.setProperty('--tag', tagBar(tags));
  applyFilter();
}

async function refreshRepo(s: Session): Promise<void> {
  try {
    const res = await daemonFetch(`/api/files/root?session=${encodeURIComponent(s.id)}`);
    if (!res.ok) return;
    const { root } = (await res.json()) as { root: string };
    const name = repoName(root);
    roots.set(s.id, root);
    if (repos.get(s.id) === name) return;
    repos.set(s.id, name);
    render(s);
  } catch {
  } finally {
    if (!looked.has(s.id)) {
      looked.add(s.id);
      applyFilter();
    }
  }
}

// Hides the tabs outside the checked filters (the active one always stays),
// forgetting checks no tab carries any more. Until every tab's repo is known
// (just after a reload) a check may only look unused, so none is forgotten.
function applyFilter(): void {
  if (store.sessions.every((s) => looked.has(s.id))) {
    const offered = new Set(filterOptions(store.sessions.map(labelsOf)).map((o) => filterKey(o.filter)));
    const before = committed.size;
    for (const k of checked) if (!offered.has(k)) checked.delete(k);
    for (const k of committed) if (!offered.has(k)) committed.delete(k);
    if (committed.size !== before) saveChecked();
  }
  for (const s of store.sessions) s.tab.hidden = s !== store.active && !matches(checked, labelsOf(s));
  const b = filterButton();
  b.setAttribute('aria-pressed', String(checked.size > 0));
  (b.querySelector('.filter-count') as HTMLElement).textContent = checked.size ? String(checked.size) : '';
  updateFades();
}

// The palette's filter page. `key` is a filter key, or null for "All tabs".
export function filterChoices(): { key: string; value: string; kind: 'repo' | 'tag'; count: number }[] {
  return filterOptions(store.sessions.map(labelsOf)).map(({ filter, count }) => ({
    key: filterKey(filter),
    value: filter.value,
    kind: filter.kind,
    count,
  }));
}

// Whether `key` is the one filter checked — or, for null, none at all.
export function filterIsCurrent(key: string | null): boolean {
  return isSingleFilter(checked, key);
}

// The picked filter's name, for the palette's root page to hint.
export function filterCurrentLabel(): string {
  if (!checked.size) return 'All';
  const only = [...checked][0] as string;
  return filterChoices().find((c) => c.key === only)?.value ?? 'All';
}

function showOnly(key: string | null): void {
  checked.clear();
  if (key) checked.add(key);
  applyFilter();
}

// A highlighted choice shows at once, without being kept yet.
export function previewFilter(key: string | null): void {
  showOnly(key);
}

// Picking a choice keeps it — the one filter, replacing any other.
export function setFilter(key: string | null): void {
  showOnly(key);
  committed.clear();
  for (const k of checked) committed.add(k);
  saveChecked();
}

// Closing the palette without a pick returns to the kept filter.
export function revertFilter(): void {
  checked.clear();
  for (const k of committed) checked.add(k);
  applyFilter();
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
  const box = document.createElement('input');
  Object.assign(box, { type: 'checkbox', className: 'input', checked: on });
  box.onchange = () => change(box.checked);
  const dot = el('i');
  if (kind === 'tag') dot.style.background = tagColor(value);
  return el('label', { className: `label menu-check ${kind}` }, box, dot, el('span', { textContent: value }));
}

// The tab's right-click menu: a box to type a new tag, then a checkbox per tag
// in use, checked for the tab's own. A typed tag is added to the tab and the
// list, and the menu stays open.
function tagMenu(s: Session): HTMLElement {
  const m = el('div', { className: 'row-menu tab-menu', role: 'dialog', ariaLabel: 'Tab tags' });
  const input = document.createElement('input');
  Object.assign(input, {
    type: 'text',
    className: 'input',
    placeholder: 'New tag…',
    maxLength: 24,
    ariaLabel: 'New tag',
  });
  const list = el('div', { className: 'menu-list' });
  const fill = () => {
    const mine = storedTags()[s.id] ?? [];
    const used = [...new Set(Object.values(storedTags()).flat())].sort();
    list.replaceChildren(
      ...used.map((tag) =>
        checkRow('tag', tag, mine.includes(tag), (on) => setTags(s, toggleTag(storedTags()[s.id] ?? [], tag, on))),
      ),
    );
  };
  input.onkeydown = (e) => {
    const tag = e.key === 'Enter' && cleanTag(input.value);
    if (!tag) return;
    setTags(s, toggleTag(storedTags()[s.id] ?? [], tag, true));
    input.value = '';
    fill();
  };
  fill();
  m.append(input, list);
  queueMicrotask(() => input.focus());
  return m;
}

// Where a new tab starts and which tags it gets, so it shows under the
// checked filters: in the checked repo's root, with every checked tag.
export function newTabFilter(): { cwd: string | null; tags: string[] } {
  const active = store.active ? (repos.get(store.active.id) ?? null) : null;
  const { repo, tags } = newTabLabels(checked, active);
  // The active tab's root first: another tab's may name a different repo of
  // the same name.
  const tab = [store.active, ...store.sessions].find((s) => s && repo && repos.get(s.id) === repo);
  return { cwd: (tab && roots.get(tab.id)) ?? null, tags };
}

// Tags a tab before it opens, so it never shows outside the filter.
export function adoptTags(id: string, tags: string[]): void {
  if (!tags.length) return;
  const all = storedTags();
  all[id] = [...new Set([...(all[id] ?? []), ...tags])];
  try {
    localStorage.setItem(TAGS_KEY, JSON.stringify(all));
  } catch {}
}

// Gives a new tab its labels and its menu.
export function labelTab(s: Session): void {
  s.tab.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showMenu(tagMenu(s), e.clientX, e.clientY);
  });
  render(s);
  void refreshRepo(s);
}

export function initTabLabels(): void {
  loadChecked();
  // The filter button itself is bound by the palette, which owns the filter
  // page; only its badge lives here, in applyFilter.
  addEventListener('pointerdown', (e) => {
    const t = e.target as Node;
    if (menu && !menu.contains(t)) closeMenu();
  });
  addEventListener('keydown', (e) => e.key === 'Escape' && closeMenu());
  // The active tab's shell may `cd` into another repo: check it on a switch
  // and every few seconds.
  onActivate(() => {
    if (store.active) void refreshRepo(store.active);
    applyFilter();
  });
  setInterval(() => store.active && !document.hidden && refreshRepo(store.active), 3000);
}
