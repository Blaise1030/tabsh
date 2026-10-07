// Linear-style status glyphs, drawn in currentColor (needs input is coloured
// by CSS). Static markup only, never user text.
import type { Status } from './model.ts';

const svg = (body: string) => `<svg viewBox="0 0 14 14" width="14" height="14" aria-hidden="true">${body}</svg>`;
const ring = '<circle cx="7" cy="7" r="5.5" fill="none" stroke="currentColor" stroke-width="1.5"';

const GLYPHS: Record<Status, string> = {
  backlog: svg(`${ring} stroke-dasharray="2.2 2"/>`),
  in_progress: svg(`${ring}/><path d="M7 3.5a3.5 3.5 0 0 1 0 7z" fill="currentColor"/>`),
  needs_input: svg('<circle cx="7" cy="7" r="6" fill="currentColor"/>'),
  completed: svg(
    '<circle cx="7" cy="7" r="6" fill="currentColor"/><path d="M4.4 7.2l1.8 1.8 3.4-3.7" fill="none" stroke="var(--background)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
  ),
  archived: svg(`${ring}/><path d="M4.5 7h5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`),
};

export const glyphSvg = (status: Status): string => GLYPHS[status];

export const STATUS_NAMES: Record<Status, string> = {
  backlog: 'Backlog',
  in_progress: 'In progress',
  needs_input: 'Needs input',
  completed: 'Completed',
  archived: 'Archived',
};
