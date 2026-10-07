// The tab strip: tab names, sideways wheel scrolling, edge fades, and
// dragging tabs into a new order.
import { api } from '../daemon/client.ts';
import { keyed } from '../ui/keyed.ts';
import { updateBadge } from './bell.ts';
import { canMove, layout, moveToGroup, sessionOf } from './groups.ts';
import { dropIndex, inOrder } from './order.ts';
import { type Session, sessionList, setSessions, store } from './store.ts';
import { tabOf } from './tab.ts';

const strip = () => document.getElementById('tabs') as HTMLElement;

export function setName(s: Session, name: string, save = true): void {
  if (s.name.val === name) return;
  s.name.val = name;
  if (s === store.active) updateBadge();
  if (save) api('PATCH', `/${s.id}`, { name, auto: true }).catch(() => {});
}

// Fade whichever edge has tabs hidden beyond it.
export function updateFades(): void {
  const el = strip();
  const end = el.scrollWidth - el.clientWidth;
  el.classList.toggle('fade-left', el.scrollLeft > 1);
  el.classList.toggle('fade-right', el.scrollLeft < end - 1);
}

// Puts the tabs in `ids` order (another browser's drag, read by `sync`),
// leaving the strip alone when it already matches.
export function orderTabs(ids: string[]): void {
  const sorted = inOrder(store.sessions, ids);
  if (sorted.every((s, i) => s === store.sessions[i])) return;
  setSessions(sorted);
  layout();
}

// Slides each tab from where it was drawn (`before`) to where it now is.
function slide(tabs: HTMLElement[], before: Map<HTMLElement, number>): void {
  for (const t of tabs) {
    const dx = (before.get(t) ?? 0) - t.getBoundingClientRect().left;
    if (dx) t.animate([{ transform: `translateX(${dx}px)` }, { transform: 'none' }], { duration: 150, easing: 'ease' });
  }
}

// The group label under the pointer, if any (beneath the dragged tab).
const labelAt = (x: number, y: number): HTMLElement | undefined =>
  document.elementsFromPoint(x, y).find((e): e is HTMLElement => e.matches('.tab-group'));

// The group a dragged tab would land in: a label under the pointer (even a
// collapsed group's), else the group whose box it sits in; null ungrouped.
function dropGroup(tab: HTMLElement, x: number, y: number): string | null {
  const box = (labelAt(x, y) ?? tab).closest<HTMLElement>('.tab-group-box');
  return box?.dataset.group ?? null;
}

// A tab dragged sideways (past a few pixels, so a click stays a click)
// follows the pointer; it moves among the other tabs as it passes their
// middles, and the new order is saved when it's let go. Grouped, letting it
// go in another group (or on its label) moves it there when it may (by tag);
// otherwise it shows it can't and goes back. A tab's copy under another tag
// drags too, moving that place only.
function initDrag(el: HTMLElement): void {
  el.addEventListener('pointerdown', (down) => {
    const target = down.target as HTMLElement;
    const tab = target.closest<HTMLElement>('.tab');
    if (down.button !== 0 || !tab || target.closest('button')) return;
    const from = tab.dataset.group ?? null;
    const grab = down.clientX - tab.getBoundingClientRect().left;
    let dragging = false;
    let over: HTMLElement | undefined; // the label it would drop on
    const move = (e: PointerEvent) => {
      if (!dragging) {
        if (Math.abs(e.clientX - down.clientX) < 5) return;
        dragging = true;
        tab.setPointerCapture(down.pointerId);
        tab.classList.add('dragging');
      }
      const others = [...el.querySelectorAll<HTMLElement>('.tab:not([hidden]):not(.leaving)')].filter((t) => t !== tab);
      const centers = others.map((t) => {
        const r = t.getBoundingClientRect();
        return r.left + r.width / 2;
      });
      const i = dropIndex(centers, e.clientX - grab + tab.offsetWidth / 2);
      const ref = i < others.length ? others[i] : (others.at(-1)?.nextSibling ?? null);
      if (ref !== tab && tab.nextSibling !== ref) {
        const before = new Map(others.map((t) => [t, t.getBoundingClientRect().left]));
        // Grouped, tabs sit in their group's box: insert beside the reference.
        const parent = (ref?.parentElement ?? others.at(-1)?.parentElement ?? el) as HTMLElement;
        parent.insertBefore(tab, ref);
        slide(others, before);
      }
      tab.style.transform = 'none';
      tab.style.transform = `translateX(${e.clientX - grab - tab.getBoundingClientRect().left}px)`;
      const label = labelAt(e.clientX, e.clientY);
      if (label !== over) {
        over?.classList.remove('drop-target');
        over = label;
      }
      const ok = canMove(from, dropGroup(tab, e.clientX, e.clientY));
      over?.classList.toggle('drop-target', ok);
      tab.classList.toggle('over-label', !!over && ok);
      tab.classList.toggle('no-drop', !ok);
    };
    const up = (e: PointerEvent) => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      removeEventListener('pointercancel', up);
      if (!dragging) return;
      over?.classList.remove('drop-target');
      const to = e.type === 'pointerup' ? dropGroup(tab, e.clientX, e.clientY) : from;
      const left = tab.getBoundingClientRect().left;
      tab.style.transform = '';
      tab.classList.remove('dragging', 'no-drop', 'over-label');
      slide([tab], new Map([[tab, left]]));
      // A copy's place in the strip isn't its tab's, so only the tab itself
      // reorders; either can change group.
      if (!tab.classList.contains('mirror')) {
        const ids = [...el.querySelectorAll<HTMLElement>('.tab:not(.mirror)')]
          .map((t) => sessionOf(t)?.id)
          .filter((id): id is string => !!id);
        setSessions(inOrder(store.sessions, ids));
        api('PUT', '/order', { ids }).catch(() => {});
      }
      const s = sessionOf(tab);
      if (s && to !== from) moveToGroup(s, from, to);
      layout(); // under its group's label: the new one, or back to its own
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
  });
}

// A closed tab collapses, then goes (the timeout covers reduced motion,
// where no transition runs); the fades are checked once it's gone.
const collapse = (node: Element): Promise<void> =>
  new Promise<void>((done) => {
    node.addEventListener('transitionend', (e) => (e as TransitionEvent).propertyName === 'max-width' && done());
    setTimeout(done, 300);
  }).then(() => void setTimeout(updateFades));

export function initTabStrip(): void {
  const el = strip();
  // The strip holds the tabs, in order. Grouped, groups.ts lays it out
  // instead (until groups are components): the list still makes each tab
  // and runs its exit, but leaves placing them to it.
  const grouped = () => !!el.querySelector(':scope > .tab-group-box');
  const parent = {
    get firstElementChild() {
      return grouped() ? null : el.firstElementChild;
    },
    insertBefore(node: Element, ref: Element | null) {
      if (!grouped()) el.insertBefore(node, ref);
    },
  };
  keyed(
    parent,
    () => sessionList.val,
    (s) => s.id,
    tabOf,
    { exit: collapse },
  );
  // Let a vertical mouse wheel scroll the tab strip sideways when it overflows.
  el.addEventListener(
    'wheel',
    (e) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        el.scrollLeft += e.deltaY;
        e.preventDefault();
      }
    },
    { passive: false },
  );
  el.addEventListener('scroll', updateFades, { passive: true });
  el.addEventListener('transitionend', updateFades); // tabs finished growing/shrinking
  new ResizeObserver(updateFades).observe(el);
  initDrag(el);
}
