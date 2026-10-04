// The pairing token the daemon prints. Requests authenticate with it; it
// arrives in the URL fragment so it never reaches a web server.
import { DAEMON } from './config.ts';
import { parseToken } from './parse.ts';

const TOKEN_KEY = `tabsh.token:${DAEMON}`;
let token: string | null = null;
// Fall back to the key from when the project was called webterm.
try {
  token = localStorage.getItem(TOKEN_KEY) ?? localStorage.getItem(`webterm.token:${DAEMON}`);
} catch {}

export function getToken(): string | null {
  return token;
}

// Takes a pairing link, its `#token=…` fragment, or the bare token, and
// remembers it for this daemon.
export function adoptToken(text: string): boolean {
  const t = parseToken(text);
  if (!t) return false;
  token = t;
  try {
    localStorage.setItem(TOKEN_KEY, t);
  } catch {}
  return true;
}
