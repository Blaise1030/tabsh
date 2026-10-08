// The statuses' names, as tabs and cards show them. The glyphs themselves
// are SVG tags in ui/icons.ts (`glyph`).
import type { Status } from './model.ts';

export const STATUS_NAMES: Record<Status, string> = {
  backlog: 'Backlog',
  in_progress: 'In progress',
  needs_input: 'Needs input',
  completed: 'Completed',
  archived: 'Archived',
};
