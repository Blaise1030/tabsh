// The divider between the terminals and the file pane. The width is live
// while dragging and saved once on release; a click without a drag splits
// them equally.
import { sendSize, store } from '../sessions/store.ts';
import { applySettings, current, onApply, saveSetting } from '../settings/settings.ts';

export function initDivider(): void {
  const ws = document.getElementById('workspace') as HTMLElement;
  const divider = document.getElementById('pane-divider') as HTMLElement;
  let frac: number | null = null;
  let startX = 0;
  let moved = false;
  let frame = 0;
  const widthAt = (x: number) => {
    const r = ws.getBoundingClientRect();
    return Math.min(0.8, Math.max(0.2, (r.right - x) / r.width));
  };
  divider.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    divider.setPointerCapture(e.pointerId);
    ws.classList.add('dragging');
    startX = e.clientX;
    moved = false;
    frac = widthAt(e.clientX);
  });
  divider.addEventListener('pointermove', (e) => {
    if (frac === null) return;
    // A few pixels of jitter in a click isn't a drag.
    if (!moved && Math.abs(e.clientX - startX) < 4) return;
    moved = true;
    frac = widthAt(e.clientX);
    ws.style.setProperty('--pane-width', String(frac));
    if (!frame) {
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (store.active) sendSize(store.active);
      });
    }
  });
  const end = (e: PointerEvent) => {
    if (frac === null) return;
    const v = frac;
    frac = null;
    ws.classList.remove('dragging');
    if (e.type === 'pointerup') saveSetting('paneWidth', moved ? v : 0.5);
    else applySettings(current.saved); // cancelled: back to the stored width
  };
  divider.addEventListener('pointerup', end);
  divider.addEventListener('pointercancel', end);
  divider.title = 'Drag to resize, click to split equally';
  onApply((s) => ws.style.setProperty('--pane-width', String(s.paneWidth)));
}
