// The divider between the terminals and the file pane. The width is live
// while dragging and saved once on release.
import { sendSize, store } from '../sessions/store.ts';
import { applySettings, current, onApply, saveSetting } from '../settings/settings.ts';

export function initDivider(): void {
  const ws = document.getElementById('workspace') as HTMLElement;
  const divider = document.getElementById('pane-divider') as HTMLElement;
  let frac: number | null = null;
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
    frac = widthAt(e.clientX);
  });
  divider.addEventListener('pointermove', (e) => {
    if (frac === null) return;
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
    if (e.type === 'pointerup') saveSetting('paneWidth', v);
    else applySettings(current.saved); // cancelled: back to the stored width
  };
  divider.addEventListener('pointerup', end);
  divider.addEventListener('pointercancel', end);
  onApply((s) => ws.style.setProperty('--pane-width', String(s.paneWidth)));
}
