// Tab groups: with the tabGrouping setting on, the strip shows a label per
// repo or per tag, each followed by its tabs. By tag, a tab with several tags
// shows in each of their groups: its first place holds the tab itself, the
// others hold copies (`.mirror`) that act for it. Clicking a
// label collapses its group (kept in this browser) to all but the active
// tab, a new tab joins the active tab's group, and the next/previous tab keys
// walk the shown tabs in strip order. Archived cards' tabs stay out of the
// strip and its groups. Dragged into another tag's group (or
// onto its label), a tab trades the tag it was dragged by for that one.
import van, { type State } from 'vanjs-core';
import type { TabGrouping } from '../settings/schema.ts';
import { current, onApply } from '../settings/settings.ts';
import { keyed } from '../ui/keyed.ts';
import { type Group, groupTabs, joinGroup, moveTag, parseCollapsed, tagColor } from './labels.ts';
import { active, type Session, store } from './store.ts';
import { sessionOfTab, Tab } from './tab.ts';
import { collapse, updateFades } from './tabs.ts';
import { labelsOf, rootOf, setTags } from './tags.ts';

const { button, div, i, small, span } = van.tags;

const COLLAPSED_KEY = 'tabsh.collapsed';

function loadCollapsed(): ReadonlySet<string> {
  try {
    return parseCollapsed(JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]'));
  } catch {
    return new Set();
  }
}

// The collapsed groups' keys, kept in this browser.
export const collapsed: State<ReadonlySet<string>> = van.state(loadCollapsed());
// Applied, not saved, so the palette's preview regroups the strip too.
export const grouping: State<TabGrouping> = van.state(current.applied.tabGrouping);
// Bumped to put every tab back in its place, after a drag moved some by hand.
const settle = van.state(0);
let activeGroup: string | null = null; // the group the active tab was picked in

const strip = () => document.getElementById('tabs') as HTMLElement;

function toggleCollapsed(key: string): void {
  const next = new Set(collapsed.val);
  if (!next.delete(key)) next.add(key);
  collapsed.val = next;
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
  } catch {}
}

// Archived cards stay off the strip, in no group, unless one is the active
// tab (picked on the board).
const onStrip = (s: Session): boolean => s.card.val.status !== 'archived' || s === store.active;

// The strip's groups as the states have them now.
const groups = (): Group[] =>
  groupTabs(
    store.sessions.filter(onStrip).map((s) => ({ id: s.id, labels: labelsOf(s) })),
    grouping.val,
  );

// A tab's place in a group: its first place is the tab, later ones copies.
interface Place {
  key: string;
  s: Session;
  copy: boolean;
}
interface Box {
  group: Group;
  places: Place[];
}
// What the strip shows: a box per group, and the tabs in no group (all of
// them while not grouping; archived ones, hidden, after the groups).
interface Layout {
  boxes: Box[];
  rest: Session[];
}

function layoutNow(): Layout {
  const all = groups();
  if (!all.length) return { boxes: [], rest: store.sessions };
  const byId = new Map(store.sessions.map((s) => [s.id, s]));
  const seen = new Set<string>();
  const boxes = all.map((group) => ({
    group,
    places: group.ids.map((id) => {
      const copy = seen.has(id);
      seen.add(id);
      return { key: `${group.key}/${id}${copy ? '/copy' : ''}`, s: byId.get(id) as Session, copy };
    }),
  }));
  return { boxes, rest: store.sessions.filter((s) => !onStrip(s)) };
}

const sessionsOf = (l: Layout): Session[] => [...l.boxes.flatMap((b) => b.places.map((p) => p.s)), ...l.rest];
const sameLayout = (a: Layout, b: Layout): boolean => {
  const [x, y] = [sessionsOf(a), sessionsOf(b)];
  return (
    x.length === y.length &&
    x.every((s, i) => s === y[i]) &&
    JSON.stringify(a.boxes.map((box) => box.group)) === JSON.stringify(b.boxes.map((box) => box.group))
  );
};

// The strip's layout as a state, replaced only when it changes: a rename or
// a status change doesn't move a tab (one being dragged stays under the
// pointer).
function layoutState(): State<Layout> {
  let last: Layout | undefined;
  return van.derive(() => {
    const next = layoutNow();
    if (last && sameLayout(last, next)) return last;
    last = next;
    return next;
  });
}

// The sessions whose tab has been on the strip: only a tab's first
// appearance grows in; moved to a new place, it shows there at once.
const drawn = new WeakSet<Session>();
function PlacedTab(s: Session, opts: { group?: string; copy?: boolean } = {}): HTMLElement {
  const t = Tab(s, { ...opts, grow: !drawn.has(s) });
  drawn.add(s);
  return t;
}

// A group's box goes at once when the strip regroups, but waits while it
// holds only closing tabs (its group emptied as they closed), so they
// collapse on screen first.
function exitBox(box: Element): Promise<void> | undefined {
  const inside = [...box.querySelectorAll(':scope > .tab')];
  if (!inside.length || !inside.every((t) => sessionOfTab(t)?.closed)) return undefined;
  return Promise.all(inside.map(collapse)).then(() => {});
}

// A tab (or copy) taken off the strip collapses when its session closed,
// and goes at once when it only changed group or the strip regrouped. Its
// `closed` flag, not a state: the list's derive calls this.
const exitTab = (node: Element): Promise<void> | undefined => (sessionOfTab(node)?.closed ? collapse(node) : undefined);

// A tab with no group, hidden while it is an archived card's (unless active).
function LoneTab(s: Session): HTMLElement {
  const t = PlacedTab(s);
  van.derive(() => {
    t.hidden = !onStrip(s);
  });
  return t;
}

// A group's box: its label (a Basecoat badge with its color's dot, its name,
// and its tab count while collapsed), then its tabs, underlined in its color
// while open. Collapsed, it shows only the active tab.
function GroupBox(g: Group, all: State<Layout>): HTMLElement {
  const key = g.key;
  const name = g.value ?? (g.kind === 'repo' ? 'No repo' : 'Untagged');
  const shut = () => collapsed.val.has(key);
  const mine = () => all.val.boxes.find((b) => b.group.key === key);
  const label = button(
    {
      type: 'button',
      class: 'badge tab-group',
      'data-variant': 'secondary',
      title: () => `${shut() ? 'Expand' : 'Collapse'} ${name}`,
      'aria-expanded': () => String(!shut()),
      onclick: () => toggleCollapsed(key),
    },
    i(),
    span({ class: 'tab-group-name' }, name),
    small(() => (shut() ? String(mine()?.group.ids.length ?? 0) : '')),
  );
  const box = div({
    class: () => (shut() ? 'tab-group-box collapsed' : 'tab-group-box'),
    role: 'presentation',
    'data-group': key,
  });
  box.style.setProperty('--group', g.value ? tagColor(g.value) : 'var(--muted-foreground)');
  type Item = Place | 'label';
  keyed<Item>(
    box,
    () => {
      settle.val;
      return ['label', ...(mine()?.places ?? [])];
    },
    (p) => (p === 'label' ? 'label' : p.key),
    (p) => {
      if (p === 'label') return label;
      const t = PlacedTab(p.s, { group: key, copy: p.copy });
      van.derive(() => {
        t.hidden = shut() && active.val !== p.s;
      });
      return t;
    },
    { exit: exitTab },
  );
  // Its narrowest: the label, and its shown tabs at their minimum width,
  // measured once the update is drawn.
  van.derive(() => {
    mine();
    shut();
    active.val;
    requestAnimationFrame(() => {
      box.style.setProperty('--label', `${label.offsetWidth}px`);
      box.style.setProperty('--tabs', String(box.querySelectorAll(':scope > .tab:not([hidden]):not(.leaving)').length));
    });
  });
  return box;
}

// The tab strip: the tabs in order, or a box per group holding its label
// and tabs, then the archived cards' tabs, hidden.
export function TabStrip(): HTMLElement {
  const all = layoutState();
  const el = div({ id: 'tabs', role: 'tablist', 'aria-label': 'Terminals' });
  type Item = { tab: Session } | { box: Group };
  keyed<Item>(
    el,
    () => {
      settle.val;
      const { boxes, rest } = all.val;
      return [...boxes.map((b) => ({ box: b.group })), ...rest.map((s) => ({ tab: s }))];
    },
    (it) => ('box' in it ? `group:${it.box.key}` : `tab:${it.tab.id}`),
    (it) => ('box' in it ? GroupBox(it.box, all) : LoneTab(it.tab)),
    { exit: (node) => (node.matches('.tab') ? exitTab(node) : exitBox(node)) },
  );
  van.derive(() => {
    all.val;
    requestAnimationFrame(updateFades);
  });
  return el;
}

// Puts every tab back in its place in the layout (a drag moved it by hand).
export function settleTabs(): void {
  settle.val = settle.val + 1;
}

// The session a tab on the strip (or one of its copies) stands for.
export function sessionOf(t: HTMLElement): Session | undefined {
  const s = sessionOfTab(t);
  return s && store.sessions.includes(s) ? s : undefined;
}

// Brings the active tab into view: its place in the group it was picked in,
// else the tab itself.
export function scrollToTab(s: Session): void {
  const places = [...strip().querySelectorAll<HTMLElement>('.tab')].filter((t) => sessionOfTab(t) === s);
  const t =
    places.find((t) => (t.dataset.group ?? null) === activeGroup) ??
    places.find((t) => !t.classList.contains('mirror'));
  t?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

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

// The group the active tab counts as in: the one it was picked in, else its
// first.
function currentGroup(all: Group[]): string | null {
  const id = store.active?.id;
  if (!id) return null;
  if (all.some((g) => g.key === activeGroup && g.ids.includes(id))) return activeGroup;
  return all.find((g) => g.ids.includes(id))?.key ?? null;
}

// Every shown place on the strip, in strip order: hidden ones (an archived
// card's, a collapsed group's other than the active tab) left out. Read from
// the states, so it is current before the strip is redrawn.
function shownPlaces(): { s: Session; group: string | null }[] {
  const { boxes, rest } = layoutNow();
  if (!boxes.length) return rest.filter(onStrip).map((s) => ({ s, group: null }));
  return boxes.flatMap(({ group, places }) =>
    places
      .filter((p) => !collapsed.val.has(group.key) || p.s === store.active)
      .map((p) => ({ s: p.s, group: group.key })),
  );
}

// The tabs showing on the strip, each once, in strip order.
export function shownSessions(): Session[] {
  return [...new Set(shownPlaces().map((p) => p.s))];
}

// The tab `step` places along the strip from the active tab's place, past
// the active tab's other places and hidden tabs, wrapping at the ends; it
// counts as picked in the group it is reached in.
export function stepTab(step: 1 | -1): Session | null {
  const from = currentGroup(groups());
  const places = shownPlaces();
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
  // A click picks a tab in the group it was clicked in.
  strip().addEventListener(
    'click',
    (e) => {
      const t = (e.target as Element).closest<HTMLElement>('.tab');
      if (t) activeGroup = t.dataset.group ?? null;
    },
    true,
  );
  onApply((s) => {
    grouping.val = s.tabGrouping;
  });
}
