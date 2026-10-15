// What the touch key bar's keys type: the keys a phone keyboard lacks. Pure.

export type ExtraKey =
  | 'esc'
  | 'tab'
  | 'shift-tab'
  | 'ctrl-c'
  | 'enter'
  | 'space'
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | '|'
  | '~'
  | '/'
  | '-';

const ARROWS: Record<string, string> = { up: 'A', down: 'B', right: 'C', left: 'D' };

// Arrows follow the program's cursor-key mode: application mode (vim, less)
// wants ESC O, the normal one ESC [. A symbol types itself.
export function keyInput(key: ExtraKey, appCursor: boolean): string {
  if (key.length === 1) return key;
  if (key === 'esc') return '\x1b';
  if (key === 'tab') return '\t';
  if (key === 'shift-tab') return '\x1b[Z';
  if (key === 'ctrl-c') return '\x03';
  if (key === 'enter') return '\r';
  if (key === 'space') return ' ';
  return `${appCursor ? '\x1bO' : '\x1b['}${ARROWS[key]}`;
}

// A key typed while Ctrl is held: a letter or one of @[\]^_ becomes its
// control code, space NUL and ? DEL; anything else is sent as it is.
export function withCtrl(data: string): string {
  if (data.length !== 1) return data;
  if (data === ' ') return '\x00';
  if (data === '?') return '\x7f';
  const code = data.toUpperCase().charCodeAt(0);
  return code >= 64 && code <= 95 ? String.fromCharCode(code - 64) : data;
}
