// Tab groups: with the tabGrouping setting on, the strip shows a label per
// repo or per tag, each followed by its tabs. By tag, a tab with several tags
// shows in each of their groups: its first place holds the tab itself, the
// others hold copies (`.mirror`) that act for it. Clicking a
// label collapses its group (kept in this browser) to all but the active
// tab, a new tab joins the active tab's group, and the next/previous tab keys
// walk the shown tabs in strip order. Archived cards' tabs stay out of the
// strip and its groups. Dragged into another tag's group (or
// onto its label), a tab trades the tag it was dragged by for that one.
import { current, onApply } from '../settings/settings.ts';
import { el } from '../ui/dom.ts';
import { type Group, groupTabs, joinGroup, moveTag, parseCollapsed, tagColor } from './labels.ts';
import { closeSession, onActivate, pick, type Session, store } from './store.ts';
import { updateFades } from './tabs.ts';
import { labelsOf, rootOf, setTags } from './tags.ts';

const COLLAPSED_KEY = 'tabsh.collapsed';
const collapsed = new Set<string>(); // group keys
const boxes = new Map<string, HTMLElement>(); // group key → its box: label, then tabs
const mirrors = new Map<string, HTMLElement[]>(); // session id → its copies
const watched = new WeakSet<HTMLElement>(); // tabs whose changes reach their copies
let activeGroup: string | null = null; // the group the active tab was picked in

const strip = () => document.getElementById('tabs') as HTMLElement;
const groupButton = () => document.getElementById('tab-group-btn') as HTMLButtonElement;

function saveCollapsed(): void {
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsed]));
  } catch {}
}

function loadCollapsed(): void {
  try {
    for (const k of parseCollapsed(JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]'))) collapsed.add(k);
  } catch {}
}

// Archived cards stay off the strip, in no group, unless one is the active
// tab (picked on the board).
const onStrip = (s: Session): boolean => s.card.status !== 'archived' || s === store.active;

// Applied, not saved, so the palette's preview regroups the strip too.
const groups = (): Group[] =>
  groupTabs(
    store.sessions.filter(onStrip).map((s) => ({ id: s.id, labels: labelsOf(s) })),
    current.applied.tabGrouping,
  );

// The group the active tab counts as in: the one it was picked in, else its
// first.
function currentGroup(all: Group[]): string | null {
  const id = store.active?.id;
  if (!id) return null;
  if (all.some((g) => g.key === activeGroup && g.ids.includes(id))) return activeGroup;
  return all.find((g) => g.ids.includes(id))?.key ?? null;
}

function toggleCollapsed(key: string): void {
  if (!collapsed.delete(key)) collapsed.add(key);
  saveCollapsed();
  layout();
}

// A group's box: its label (a Basecoat badge with its color's dot, its name,
// and its tab count while collapsed), then its tabs, underlined in its color
// while open.
function boxOf(g: Group): HTMLElement {
  let box = boxes.get(g.key);
  if (!box) {
    const label = el(
      'button',
      { type: 'button', className: 'badge tab-group' },
      el('i'),
      el('span', { className: 'tab-group-name' }),
      el('small'),
    );
    label.dataset.variant = 'secondary';
    label.onclick = () => toggleCollapsed(g.key);
    box = el('div', { className: 'tab-group-box', role: 'presentation' }, label);
    box.dataset.group = g.key;
    boxes.set(g.key, box);
  }
  const label = box.firstElementChild as HTMLElement;
  const name = g.value ?? (g.kind === 'repo' ? 'No repo' : 'Untagged');
  const shut = collapsed.has(g.key);
  (label.querySelector('.tab-group-name') as HTMLElement).textContent = name;
  (label.querySelector('small') as HTMLElement).textContent = shut ? String(g.ids.length) : '';
  label.title = `${shut ? 'Expand' : 'Collapse'} ${name}`;
  label.setAttribute('aria-expanded', String(!shut));
  box.style.setProperty('--group', g.value ? tagColor(g.value) : 'var(--muted-foreground)');
  box.classList.toggle('collapsed', shut);
  return box;
}

// Puts `nodes` in `parent` in order, moving only what is out of place and
// leaving closing tabs where they are, to finish shrinking.
function place(parent: HTMLElement, nodes: HTMLElement[]): void {
  let at = parent.firstElementChild;
  for (const node of nodes) {
    while (at?.classList.contains('leaving')) at = at.nextElementSibling;
    if (node === at) at = at.nextElementSibling;
    else parent.insertBefore(node, at);
  }
}

// A copy of a tab for another of its groups, acting as the tab: a click
// picks it (in the copy's group, set by the strip's listener), its close
// button or a middle-click closes it, and a right-click opens its tag menu.
function copyOf(s: Session): HTMLElement {
  const m = s.tab.cloneNode(true) as HTMLElement;
  m.classList.add('mirror');
  m.classList.remove('entering', 'leaving', 'dragging');
  m.onclick = (e) => ((e.target as Element).closest('button') ? closeSession(s) : pick(s));
  m.onauxclick = (e) => e.button === 1 && closeSession(s);
  m.oncontextmenu = (e) => {
    e.preventDefault();
    s.tab.dispatchEvent(new MouseEvent('contextmenu', e));
  };
  return m;
}

// Copies follow their tab: a rename, the selection, a bell or new tags.
function watch(s: Session): void {
  if (watched.has(s.tab)) return;
  watched.add(s.tab);
  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      for (const [i, old] of (mirrors.get(s.id) ?? []).entries()) {
        if (old.classList.contains('dragging')) continue; // caught up by the next change
        const fresh = copyOf(s);
        fresh.dataset.group = old.dataset.group;
        fresh.hidden = old.hidden;
        old.replaceWith(fresh);
        (mirrors.get(s.id) as HTMLElement[])[i] = fresh;
      }
    });
  }).observe(s.tab, {
    attributes: true,
    attributeFilter: ['class', 'aria-selected', 'title', 'style'],
    childList: true,
    subtree: true,
    characterData: true,
  });
}

// Lays the strip out: the tabs in order, or a box per group holding its
// label and tabs, with collapsed groups showing only the active tab.
export function layout(): void {
  const all = groups();
  const top: HTMLElement[] = []; // the strip's children
  const inside = new Map<HTMLElement, HTMLElement[]>(); // box → its children
  const places = new Map<string, number>(); // session id → places so far
  const byId = new Map(store.sessions.map((s) => [s.id, s]));
  // Ungrouped, every tab sits on the strip itself; grouped, those in no
  // group (archived) wait hidden after the groups.
  for (const s of store.sessions)
    if (!all.length || !onStrip(s)) {
      s.tab.hidden = !onStrip(s);
      delete s.tab.dataset.group;
      if (!all.length) top.push(s.tab);
    }
  for (const g of all) {
    const box = boxOf(g);
    const want = [box.firstElementChild as HTMLElement];
    top.push(box);
    inside.set(box, want);
    for (const id of g.ids) {
      const s = byId.get(id) as Session;
      const n = places.get(id) ?? 0;
      places.set(id, n + 1);
      let t = s.tab;
      if (n) {
        const list = mirrors.get(id) ?? [];
        mirrors.set(id, list);
        list[n - 1] ??= copyOf(s);
        t = list[n - 1];
        watch(s);
      }
      t.dataset.group = g.key;
      t.hidden = collapsed.has(g.key) && s !== store.active;
      want.push(t);
    }
  }
  if (all.length) top.push(...store.sessions.filter((s) => !onStrip(s)).map((s) => s.tab));
  place(strip(), top);
  for (const [box, want] of inside) {
    place(box, want);
    // Its narrowest: the label, and its shown tabs at their minimum width.
    box.style.setProperty('--label', `${want[0].offsetWidth}px`);
    box.style.setProperty('--tabs', String(want.filter((t) => !t.hidden).length - 1));
  }
  // Drop copies and boxes nothing uses any more.
  for (const [id, list] of mirrors) {
    const keep = Math.max(0, (places.get(id) ?? 0) - 1);
    for (const m of list.splice(keep)) m.remove();
    if (!list.length) mirrors.delete(id);
  }
  const live = new Set(all.map((g) => g.key));
  for (const [key, box] of boxes)
    if (!live.has(key)) {
      box.remove();
      boxes.delete(key);
    }
  groupButton().setAttribute('aria-pressed', String(current.applied.tabGrouping !== 'none'));
  updateFades();
}

// The session a tab on the strip (or one of its copies) stands for.
export const sessionOf = (t: HTMLElement): Session | undefined =>
  store.sessions.find((s) => s.tab === t || mirrors.get(s.id)?.includes(t));

// Whether a tab dragged out of group `from` may land in group `to`: by tag
// yes; by repo only in its own, since its group is where its shell is.
export const canMove = (from: string | null, to: string | null): boolean =>
  from === to || current.applied.tabGrouping === 'tag';

// Moves a tab dragged out of group `from` into group `to`: it trades the tag
// it was dragged by for the target's, and counts as picked there.
export function moveToGroup(s: Session, from: string | null, to: string | null): void {
  if (from === to || !canMove(from, to)) return;
  if (s === store.active) activeGroup = to;
  setTags(s, moveTag(labelsOf(s).tags, joinGroup(from).tag, joinGroup(to).tag));
}

// The tabs showing on the strip, each once, in strip order.
export function shownSessions(): Session[] {
  const out: Session[] = [];
  for (const t of strip().querySelectorAll<HTMLElement>('.tab:not([hidden]):not(.leaving)')) {
    const s = sessionOf(t);
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

// The tab `step` places along the strip from the active tab's place, past
// the active tab's other places and hidden tabs, wrapping at the ends; it
// counts as picked in the group it is reached in.
export function stepTab(step: 1 | -1): Session | null {
  const from = currentGroup(groups());
  const places = [...strip().querySelectorAll<HTMLElement>('.tab:not([hidden]):not(.leaving)')].flatMap((t) => {
    const s = sessionOf(t);
    return s ? [{ s, group: t.dataset.group ?? null }] : [];
  });
  const n = places.length;
  let i = places.findIndex((p) => p.s === store.active && p.group === from);
  if (i < 0) i = places.findIndex((p) => p.s === store.active);
  for (let k = 1; k <= n; k++) {
    const p = places[(((i + step * k) % n) + n) % n];
    if (p.s !== store.active) {
      activeGroup = p.group;
      return p.s;
    }
  }
  return null;
}

// What a new tab needs to join the active tab's group: that group's tag, or
// the folder to start in for its repo. It then counts as picked there.
export function newTabGroup(): { cwd: string | null; tag: string | null } {
  const key = currentGroup(groups());
  const { tag, repo } = joinGroup(key);
  const same = repo ? [store.active, ...store.sessions].find((s) => s && labelsOf(s).repo === repo) : undefined;
  activeGroup = key;
  return { cwd: same ? rootOf(same) : null, tag };
}

export function initTabGroups(): void {
  loadCollapsed();
  // A click picks a tab in the group it was clicked in.
  strip().addEventListener(
    'click',
    (e) => {
      const t = (e.target as Element).closest<HTMLElement>('.tab');
      if (t) activeGroup = t.dataset.group ?? null;
    },
    true,
  );
  onActivate(layout);
  onApply(layout);
}
