// Tab labels: the repo a tab's shell is in, read from the daemon, and the tags
// checked in the tab's right-click menu (kept in this browser). A tagged tab
// shows its tags' colors; the filter button beside settings shows only the
// tabs under the repos and tags checked there.
import { daemonFetch } from '../daemon/client.ts';
import { el } from '../ui/dom.ts';
import {
  cleanTag,
  filterKey,
  filterOptions,
  type Labels,
  matches,
  parseTags,
  repoName,
  tagBar,
  tagColor,
  toggleTag,
} from './labels.ts';
import { onActivate, type Session, store } from './store.ts';
import { updateFades } from './tabs.ts';

const TAGS_KEY = 'tabsh.tags';
const repos = new Map<string, string>(); // session id → repo label
const checked = new Set<string>(); // filter keys
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
    const name = repoName(((await res.json()) as { root: string }).root);
    if (repos.get(s.id) === name) return;
    repos.set(s.id, name);
    render(s);
  } catch {}
}

// Hides the tabs outside the checked filters (the active one always stays),
// forgetting checks no tab carries any more.
function applyFilter(): void {
  const offered = new Set(filterOptions(store.sessions.map(labelsOf)).map((o) => filterKey(o.filter)));
  for (const k of checked) if (!offered.has(k)) checked.delete(k);
  for (const s of store.sessions) s.tab.hidden = s !== store.active && !matches(checked, labelsOf(s));
  const b = filterButton();
  b.setAttribute('aria-pressed', String(checked.size > 0));
  (b.querySelector('.filter-count') as HTMLElement).textContent = checked.size ? String(checked.size) : '';
  updateFades();
}

function closeMenu(): void {
  menu?.remove();
  menu = null;
}

// Opens a menu at (x, y): its left edge there, or with `alignRight` its right
// edge, kept inside the window.
function showMenu(m: HTMLElement, x: number, y: number, alignRight = false): void {
  closeMenu();
  m.style.top = `${y}px`;
  document.body.append(m);
  const left = alignRight ? x - m.offsetWidth : x;
  m.style.left = `${Math.max(8, Math.min(left, innerWidth - m.offsetWidth - 8))}px`;
  menu = m;
}

// Icons (Lucide paths) for the menus' footer actions.
const FILTER_X = ['M13.013 3H2l8 9.46V19l4 2v-8.54l.9-1.055', 'm22 3-5 5', 'm17 3 5 5'];

function icon(paths: string[]): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  for (const [k, v] of Object.entries({
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '2',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
  }))
    svg.setAttribute(k, v);
  for (const d of paths) {
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

// A menu's last action, set apart by a line, with a leading icon. Picking it
// closes the menu.
function footer(label: string, paths: string[], run: () => void): HTMLElement {
  const b = el('button', { type: 'button', role: 'menuitem' }, icon(paths), label);
  b.onclick = () => {
    run();
    closeMenu();
  };
  return el('div', { className: 'menu-foot' }, el('div', { className: 'menu-sep' }), b);
}

// A checkbox row, as Basecoat's label and checkbox: a tag gets its color's
// dot, and `count` (when given) shows at the end.
function checkRow(
  kind: 'repo' | 'tag',
  value: string,
  on: boolean,
  change: (on: boolean) => void,
  count?: number,
): HTMLElement {
  const box = document.createElement('input');
  Object.assign(box, { type: 'checkbox', className: 'input', checked: on });
  box.onchange = () => change(box.checked);
  const dot = el('i');
  if (kind === 'tag') dot.style.background = tagColor(value);
  return el(
    'label',
    { className: `label menu-check ${kind}` },
    box,
    dot,
    el('span', { textContent: value }),
    ...(count === undefined ? [] : [el('small', { textContent: String(count) })]),
  );
}

// The filter's popover: a checkbox per repo and per tag, with its tab count.
function filterMenu(): HTMLElement {
  const m = el('div', { className: 'row-menu tab-menu filter-menu', role: 'dialog', ariaLabel: 'Filter tabs' });
  const options = filterOptions(store.sessions.map(labelsOf));
  for (const kind of ['repo', 'tag'] as const) {
    const mine = options.filter((o) => o.filter.kind === kind);
    m.append(el('div', { className: 'menu-heading', textContent: kind === 'repo' ? 'Repos' : 'Tags' }));
    if (!mine.length && kind === 'tag')
      m.append(el('div', { className: 'menu-hint', textContent: 'Right-click a tab to tag it' }));
    for (const { filter, count } of mine) {
      const key = filterKey(filter);
      const row = checkRow(
        kind,
        filter.value,
        checked.has(key),
        (on) => {
          if (on) checked.add(key);
          else checked.delete(key);
          applyFilter();
          clear.hidden = !checked.size;
        },
        count,
      );
      m.append(row);
    }
  }
  const clear = footer('Show all tabs', FILTER_X, () => {
    checked.clear();
    applyFilter();
  });
  clear.hidden = !checked.size;
  m.append(clear);
  return m;
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
  const b = filterButton();
  b.onclick = () => {
    if (menu?.classList.contains('filter-menu')) return closeMenu();
    const r = b.getBoundingClientRect();
    showMenu(filterMenu(), r.right, r.bottom + 4, true);
  };
  addEventListener('pointerdown', (e) => {
    const t = e.target as Node;
    if (menu && !menu.contains(t) && !b.contains(t)) closeMenu();
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
