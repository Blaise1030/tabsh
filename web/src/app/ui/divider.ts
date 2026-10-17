// The divider between the terminals and the file pane. The width is live
// while dragging and saved once on release; a click without a drag splits
// them equally.
import { onScreen, sendSize } from '../sessions/store.ts';
import { applySettings, current, onApply, saveSetting } from '../settings/settings.ts';

export function initDivider(): void {
  const ws = document.getElementById('workspace') as HTMLElement;
  const divider = document.getElementById('pane-divider') as HTMLElement;
  const pane = document.getElementById('pane') as HTMLElement;
  let frac: number | null = null;
  let startX = 0;
  let moved = false;
  let frame = 0;
  // From the pane's right edge, not the workspace's: the file sidebar may sit past it.
  const widthAt = (x: number) =>
    Math.min(0.8, Math.max(0.2, (pane.getBoundingClientRect().right - x) / ws.getBoundingClientRect().width));
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
        const shown = onScreen();
        if (shown) sendSize(shown);
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

// The divider between the board and its drawer: the same drag, as a share of
// the page's width, saved as `drawerWidth`; a click halves the page.
export function initDrawerDivider(): void {
  const stage = document.getElementById('stage') as HTMLElement;
  const divider = document.getElementById('drawer-divider') as HTMLElement;
  let frac: number | null = null;
  let startX = 0;
  let moved = false;
  // The stage has no box while the split is showing (it is display:contents,
  // so the terminal can be a full-height column). Measure the board and the
  // terminal instead. --drawer-width lives on the document: the body's grid
  // reads it, and the stage is not an ancestor of the body.
  const widthAt = (x: number) => {
    const board = document.getElementById('board') as HTMLElement;
    const frame = document.getElementById('frame') as HTMLElement;
    const left = board.getBoundingClientRect().left;
    const right = frame.getBoundingClientRect().right;
    const width = right - left;
    return Math.min(0.85, Math.max(0.25, width > 0 ? (right - x) / width : 0.5));
  };
  const setWidth = (frac: number) => document.documentElement.style.setProperty('--drawer-width', String(frac));
  divider.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    divider.setPointerCapture(e.pointerId);
    stage.classList.add('dragging');
    startX = e.clientX;
    moved = false;
    frac = widthAt(e.clientX);
  });
  divider.addEventListener('pointermove', (e) => {
    if (frac === null) return;
    if (!moved && Math.abs(e.clientX - startX) < 4) return;
    moved = true;
    frac = widthAt(e.clientX);
    setWidth(frac); // the terminal refits through its ResizeObserver
  });
  const end = (e: PointerEvent) => {
    if (frac === null) return;
    const v = frac;
    frac = null;
    stage.classList.remove('dragging');
    if (e.type === 'pointerup') saveSetting('drawerWidth', moved ? v : 0.5);
    else applySettings(current.saved);
  };
  divider.addEventListener('pointerup', end);
  divider.addEventListener('pointercancel', end);
  divider.title = 'Drag to resize, click to split equally';
  onApply((s) => setWidth(s.drawerWidth));
}
