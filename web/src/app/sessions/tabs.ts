// The tab strip: tab names, sideways wheel scrolling, and edge fades.
import { api } from '../daemon/client.ts';
import { updateBadge } from './bell.ts';
import { type Session, store } from './store.ts';

const strip = () => document.getElementById('tabs') as HTMLElement;

export function setName(s: Session, name: string, save = true): void {
  const label = s.tab.querySelector('span') as HTMLElement;
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
}
