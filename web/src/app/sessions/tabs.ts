// The tab strip: tab names, sideways wheel scrolling, edge fades, and
// dragging tabs into a new order.
import { api } from '../daemon/client.ts';
import { updateBadge } from './bell.ts';
import { layout } from './groups.ts';
import { dropIndex, inOrder } from './order.ts';
import { type Session, store } from './store.ts';

const strip = () => document.getElementById('tabs') as HTMLElement;

export function setName(s: Session, name: string, save = true): void {
  const label = s.tab.querySelector('.tab-name') as HTMLElement;
  if (s.name === name && label.textContent) return;
  s.name = name;
  label.textContent = s.tab.title = name;
  if (s === store.active) updateBadge();
  if (save) api('PATCH', `/${s.id}`, { name }).catch(() => {});
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
  store.sessions.splice(0, store.sessions.length, ...sorted);
  layout();
}

// Slides each tab from where it was drawn (`before`) to where it now is.
function slide(tabs: HTMLElement[], before: Map<HTMLElement, number>): void {
  for (const t of tabs) {
    const dx = (before.get(t) ?? 0) - t.getBoundingClientRect().left;
    if (dx) t.animate([{ transform: `translateX(${dx}px)` }, { transform: 'none' }], { duration: 150, easing: 'ease' });
  }
}

// A tab dragged sideways (past a few pixels, so a click stays a click)
// follows the pointer; it moves among the other tabs as it passes their
// middles, and the new order is saved when it's let go.
function initDrag(el: HTMLElement): void {
  el.addEventListener('pointerdown', (down) => {
    const target = down.target as HTMLElement;
    const tab = target.closest<HTMLElement>('.tab');
    if (down.button !== 0 || !tab || tab.classList.contains('mirror') || target.closest('button')) return;
    const grab = down.clientX - tab.getBoundingClientRect().left;
    let dragging = false;
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
    };
    const up = () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      removeEventListener('pointercancel', up);
      if (!dragging) return;
      const left = tab.getBoundingClientRect().left;
      tab.style.transform = '';
      tab.classList.remove('dragging');
      slide([tab], new Map([[tab, left]]));
      const ids = [...el.querySelectorAll<HTMLElement>('.tab')]
        .map((t) => store.sessions.find((s) => s.tab === t)?.id)
        .filter((id): id is string => !!id);
      store.sessions.splice(0, store.sessions.length, ...inOrder(store.sessions, ids));
      layout(); // back under its group's label, wherever it was dropped
      api('PUT', '/order', { ids }).catch(() => {});
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
  });
}

export function initTabStrip(): void {
  const el = strip();
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
