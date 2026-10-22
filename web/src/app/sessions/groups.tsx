// Tab groups: with the tabGrouping setting on, the strip shows a label per
// repo or per tag, each followed by its tabs. By tag, a tab with several tags
// shows in each of their groups: its first place holds the tab itself, the
// others hold copies (`.mirror`) that act for it. Clicking a
// label collapses its group (kept in this browser) to all but the active
// tab, a new tab joins the active tab's group, and the next/previous tab keys
// walk the shown tabs in strip order. Archived cards' tabs stay out of the
// strip and its groups. Dragged into another tag's group (or
// onto its label), a tab trades the tag it was dragged by for that one.
import {
  type Accessor,
  children,
  createEffect,
  createMemo,
  createRenderEffect,
  createSignal,
  type JSX,
  onCleanup,
  untrack,
} from 'solid-js';
import type { TabGrouping } from '../settings/schema.ts';
import { current, onApply } from '../settings/settings.ts';
import { Presence } from '../ui/presence.tsx';
import { type Group, groupTabs, joinGroup, moveTag, parseCollapsed, tagColor } from './labels.ts';
import { active, type Session, sessionList, store } from './store.ts';
import { sessionOfTab, Tab } from './tab.tsx';
import { collapse, updateFades } from './tabs.ts';
import { labelsOf, rootOf, setTags } from './tags.tsx';

const COLLAPSED_KEY = 'tabsh.collapsed';

function loadCollapsed(): ReadonlySet<string> {
  try {
    return parseCollapsed(JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]'));
  } catch {
    return new Set();
  }
}

// The collapsed groups' keys, kept in this browser.
export const [collapsed, setCollapsed] = createSignal<ReadonlySet<string>>(loadCollapsed());
// Applied, not saved, so the palette's preview regroups the strip too.
export const [grouping, setGrouping] = createSignal<TabGrouping>(current.applied.tabGrouping);
let activeGroup: string | null = null; // the group the active tab was picked in

const strip = () => document.getElementById('tabs') as HTMLElement;

function toggleCollapsed(key: string): void {
  const next = new Set(collapsed());
  if (!next.delete(key)) next.add(key);
  setCollapsed(next);
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
  } catch {}
}

// How the layout reads a signal: as it is now, or followed by the strip.
type Read = <T>(acc: Accessor<T>) => T;
const now: Read = (acc) => acc();
const followed: Read = (acc) => acc();

// Archived cards stay off the strip, in no group, unless one is the active
// tab (picked on the board).
const onStrip = (s: Session, read: Read = now): boolean => read(s.card).status !== 'archived' || s === read(active);

// The strip's groups as the states have them now.
const groups = (read: Read = now): Group[] =>
  groupTabs(
    read(sessionList)
      .filter((s) => onStrip(s, read))
      .map((s) => ({ id: s.id, labels: { repo: read(s.repo), tags: read(s.tags) } })),
    read(grouping),
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

// What `map` holds for `key`, made on first use.
function kept<K, V>(map: { get(k: K): V | undefined; set(k: K, v: V): unknown }, key: K, make: () => V): V {
  const had = map.get(key);
  if (had !== undefined) return had;
  const made = make();
  map.set(key, made);
  return made;
}

// Each session object's own number, so a tab reopened under the same id gets
// a row of its own rather than a closing one's.
const serials = new WeakMap<Session, number>();
let serial = 0;
const serialOf = (s: Session): number => kept(serials, s, () => ++serial);

// The same place object for the same key: the lists below keep a row per
// object, so a fresh one would redraw its tab.
const placeCache = new WeakMap<Session, Map<string, Place>>();
function placeOf(group: string, s: Session, copy: boolean): Place {
  const key = `${group}/${serialOf(s)}${copy ? '/copy' : ''}`;
  return kept(
    kept(placeCache, s, () => new Map()),
    key,
    () => ({ key, s, copy }),
  );
}

function layoutOf(read: Read = now): Layout {
  const sessions = read(sessionList);
  const all = groups(read);
  if (!all.length) return { boxes: [], rest: sessions };
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const seen = new Set<string>();
  const boxes = all.map((group) => ({
    group,
    places: group.ids.map((id) => {
      const copy = seen.has(id);
      seen.add(id);
      return placeOf(group.key, byId.get(id) as Session, copy);
    }),
  }));
  return { boxes, rest: sessions.filter((s) => !onStrip(s, read)) };
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

// The rows each list on the strip draws, in order: the strip's own, and each
// group box's after its label.
const lists = new Set<() => { parent: Element; rows: Element[] }>();

// Puts every row back where its list has it, moving only what is out of
// place. A drag moves a tab by hand, perhaps into another box; a list's next
// update expects its own order.
function restore(): void {
  for (const list of lists) {
    const { parent, rows } = list();
    let at = parent.firstElementChild;
    for (const row of rows) {
      if (row === at) at = at.nextElementSibling;
      else parent.insertBefore(row, at);
    }
  }
}

// The strip's layout, replaced only when it changes: a rename or a status
// change doesn't move a tab (one being dragged stays under the pointer).
// Before a new layout is drawn, the rows are put back in their lists' order.
function createLayout(): Accessor<Layout> {
  return createMemo<Layout>((last) => {
    const next = layoutOf(followed);
    if (last && sameLayout(last, next)) return last;
    untrack(restore);
    return next;
  });
}

// The sessions whose tab has been on the strip: only a tab's first
// appearance grows in; moved to a new place, it shows there at once.
const drawn = new WeakSet<Session>();
function PlacedTab(props: { session: Session; group?: string; copy?: boolean }): HTMLElement {
  const s = props.session;
  const grow = !drawn.has(s);
  drawn.add(s);
  return (<Tab session={s} group={props.group} copy={props.copy} grow={grow} />) as HTMLElement;
}

// A group's box goes at once when the strip regroups, but waits while it
// holds only closing tabs (its group emptied as they closed), so they
// collapse on screen first.
function exitBox(box: Element): Promise<void> {
  const inside = [...box.querySelectorAll(':scope > .tab')];
  if (!inside.length || !inside.every((t) => sessionOfTab(t)?.closed)) return Promise.resolve();
  return Promise.all(inside.map(collapse)).then(() => {});
}

// A tab (or copy) taken off the strip collapses when its session closed,
// and goes at once when it only changed group or the strip regrouped. A
// closed session never comes back (a reopened one is a new object), so
// there's no collapse to undo.
const exitTab = (node: Element): Promise<void> => (sessionOfTab(node)?.closed ? collapse(node) : Promise.resolve());

// A tab with no group, hidden while it is an archived card's (unless active).
function LoneTab(props: { session: Session }): HTMLElement {
  const s = props.session;
  const t = (<PlacedTab session={s} />) as HTMLElement;
  createRenderEffect(() => {
    t.hidden = !onStrip(s, followed);
  });
  return t;
}

// A list's rows, kept for `restore` while the list is on the page.
function listed(parent: () => Element, rows: { toArray(): unknown[] }): void {
  const list = () => ({ parent: parent(), rows: rows.toArray() as Element[] });
  lists.add(list);
  onCleanup(() => lists.delete(list));
}

// A group's box: its label (a Basecoat badge with its color's dot, its name,
// and its tab count while collapsed), then its tabs, underlined in its color
// while open. Collapsed, it shows only the active tab.
function GroupBox(props: { group: Group; layout: Accessor<Layout> }): HTMLElement {
  const g = props.group;
  const key = g.key;
  const name = g.value ?? (g.kind === 'repo' ? 'No repo' : 'Untagged');
  const shut = () => collapsed().has(key);
  const mine = () => props.layout().boxes.find((b) => b.group.key === key);
  const shown = active;
  const nodes = new WeakMap<Place, Element>();
  const rows = children(() => (
    <Presence
      each={mine()?.places ?? []}
      by={(p) => p.key}
      exit={(p) => {
        const node = nodes.get(p);
        return node ? exitTab(node) : Promise.resolve();
      }}
    >
      {(p) => {
        const t = (<PlacedTab session={p.s} group={key} copy={p.copy} />) as HTMLElement;
        createRenderEffect(() => {
          t.hidden = shut() && shown() !== p.s;
        });
        nodes.set(p, t);
        return t;
      }}
    </Presence>
  ));
  let label!: HTMLButtonElement;
  const box = (
    <div class="tab-group-box" classList={{ collapsed: shut() }} role="presentation" data-group={key}>
      <button
        ref={label}
        type="button"
        class="badge tab-group"
        data-variant="secondary"
        title={`${shut() ? 'Expand' : 'Collapse'} ${name}`}
        aria-expanded={!shut()}
        onClick={() => toggleCollapsed(key)}
      >
        <i />
        <span class="tab-group-name">{name}</span>
        <small>{shut() ? String(mine()?.group.ids.length ?? 0) : ''}</small>
      </button>
      {rows()}
    </div>
  ) as HTMLElement;
  box.style.setProperty('--group', g.value ? tagColor(g.value) : 'var(--muted-foreground)');
  listed(() => box, { toArray: () => [label, ...rows.toArray()] });
  // Its narrowest: the label, and its shown tabs at their minimum width,
  // measured once the update is drawn.
  createEffect(() => {
    mine();
    shut();
    shown();
    requestAnimationFrame(() => {
      box.style.setProperty('--label', `${label.offsetWidth}px`);
      box.style.setProperty('--tabs', String(box.querySelectorAll(':scope > .tab:not([hidden]):not(.leaving)').length));
    });
  });
  return box;
}

// What the strip lists: a group's box, or a tab in no group. The same object
// for the same box or tab, so its row stays.
type Item = { box: Group } | { tab: Session };
const boxItems = new Map<string, { box: Group }>();
const tabItems = new WeakMap<Session, { tab: Session }>();
const boxItem = (group: Group): { box: Group } => kept(boxItems, group.key, () => ({ box: group }));
const tabItem = (s: Session): { tab: Session } => kept(tabItems, s, () => ({ tab: s }));

// The tab strip: the tabs in order, or a box per group holding its label
// and tabs, then the archived cards' tabs, hidden.
export function TabStrip(): JSX.Element {
  const layout = createLayout();
  const items = createMemo<Item[]>(() => {
    const { boxes, rest } = layout();
    return [...boxes.map((b) => boxItem(b.group)), ...rest.map(tabItem)];
  });
  const nodes = new WeakMap<Item, Element>();
  const rows = children(() => (
    <Presence
      each={items()}
      by={(it) => ('box' in it ? `group:${it.box.key}` : `tab:${serialOf(it.tab)}`)}
      exit={(it) => {
        const node = nodes.get(it);
        if (!node) return Promise.resolve();
        return 'box' in it ? exitBox(node) : exitTab(node);
      }}
    >
      {(it) => {
        const node = 'box' in it ? <GroupBox group={it.box} layout={layout} /> : <LoneTab session={it.tab} />;
        nodes.set(it, node as Element);
        return node;
      }}
    </Presence>
  ));
  const el = (
    <div id="tabs" role="tablist" aria-label="Terminals">
      {rows()}
    </div>
  ) as HTMLElement;
  listed(() => el, rows);
  createEffect(() => {
    layout();
    requestAnimationFrame(updateFades);
  });
  return el;
}

// Puts every tab back in its place in the layout (a drag moved it by hand).
// The lists then draw whatever the drop changed from a page that matches them.
export function settleTabs(): void {
  restore();
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
  const { boxes, rest } = layoutOf();
  if (!boxes.length) return rest.filter((s) => onStrip(s)).map((s) => ({ s, group: null }));
  return boxes.flatMap(({ group, places }) =>
    places
      .filter((p) => !collapsed().has(group.key) || p.s === store.active)
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
    setGrouping(s.tabGrouping);
  });
}
