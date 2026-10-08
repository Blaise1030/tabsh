export type View = 'terms' | 'board';
export type Step = 'tab' | 'view' | 'drawer' | 'file' | 'explorer' | 'palette';
export type Place = {
  tab: string | null;
  view: View;
  // On the board: the tab's terminal shows in a drawer beside it.
  drawer: boolean;
  file: string | null;
  line: number | null;
  explorer: boolean;
  palette: string | null;
};

export const HOME: Place = {
  tab: null,
  view: 'terms',
  drawer: false,
  file: null,
  line: null,
  explorer: false,
  palette: null,
};
export const STEPS: readonly Step[] = ['tab', 'view', 'drawer', 'file', 'explorer', 'palette'];

const KEYS = ['tab', 'view', 'drawer', 'file', 'line', 'explorer', 'palette'];
const MAX_FILE = 4096;
const MAX_VALUE = 128;

// Only values that pass the limits survive; anything else reads as absent.
export function fromQuery(q: URLSearchParams): Partial<Place> {
  const out: Partial<Place> = {};
  const tab = q.get('tab');
  if (tab && tab.length <= MAX_VALUE) out.tab = tab;
  const view = q.get('view');
  if (view === 'terms' || view === 'board') out.view = view;
  if (view === 'board' && q.get('drawer') === '1') out.drawer = true;
  const file = q.get('file');
  if (file && file.length <= MAX_FILE) {
    out.file = file;
    const raw = q.get('line');
    if (raw && raw.length <= MAX_VALUE && /^\d+$/.test(raw) && Number(raw) > 0) out.line = Number(raw);
  }
  if (q.get('explorer') === '1') out.explorer = true;
  const palette = q.get('palette');
  if (palette && /^[A-Za-z]{1,64}$/.test(palette)) out.palette = palette;
  return out;
}

export function toQuery(p: Place, keep: URLSearchParams): string {
  const q = new URLSearchParams(keep);
  for (const k of KEYS) q.delete(k);
  if (p.tab) q.set('tab', p.tab);
  if (p.view !== 'terms') q.set('view', p.view);
  if (p.drawer) q.set('drawer', '1');
  if (p.file) {
    q.set('file', p.file);
    if (p.line) q.set('line', String(p.line));
  }
  if (p.explorer) q.set('explorer', '1');
  if (p.palette) q.set('palette', p.palette);
  const s = q.toString();
  return s ? `?${s}` : '';
}

// A push closes the palette unless the patch sets it; a different tab drops the old tab's file.
export function merge(from: Place, patch: Partial<Place>, how: 'push' | 'replace'): Place {
  const to = { ...from, ...patch };
  if (to.view !== 'board') to.drawer = false;
  if (how === 'push' && patch.palette === undefined) to.palette = null;
  if (patch.tab !== undefined && patch.tab !== from.tab && patch.file === undefined) to.file = null;
  if (patch.file !== undefined && patch.line === undefined) to.line = null;
  if (!to.file) to.line = null;
  return to;
}

export function changed(from: Place, to: Place): Step[] {
  const out: Step[] = [];
  if (from.tab !== to.tab) out.push('tab');
  if (from.view !== to.view) out.push('view');
  if (from.drawer !== to.drawer) out.push('drawer');
  if (from.file !== to.file || from.line !== to.line) out.push('file');
  if (from.explorer !== to.explorer) out.push('explorer');
  if (from.palette !== to.palette) out.push('palette');
  return out;
}

export function fileAction(from: Place, to: Place): 'keep' | 'adopt' | 'open' | 'close' {
  if (!to.file) {
    if (from.tab !== to.tab) return 'adopt';
    return from.file ? 'close' : 'keep';
  }
  if (from.tab === to.tab && from.file === to.file && from.line === to.line) return 'keep';
  return 'open';
}
