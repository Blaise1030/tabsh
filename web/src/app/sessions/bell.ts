// A BEL from a shell, unless you're looking at that terminal, marks its tab
// and badges the favicon and title until you visit it.
import { type Session, store } from './store.ts';

const faviconSvg = (badge: boolean) =>
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
      '<rect width="32" height="32" rx="7" fill="#18181b"/>' +
      '<path d="M8 11l5 5-5 5M15 22h9" fill="none" stroke="#e4e4e7" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>' +
      (badge ? '<circle cx="25" cy="7" r="6.5" fill="#f97316" stroke="#18181b" stroke-width="2"/>' : '') +
      '</svg>',
  );
const FAVICON = faviconSvg(false);
const FAVICON_BELL = faviconSvg(true);
const favicon = () => document.getElementById('favicon') as HTMLLinkElement;

const rings = new WeakMap<Session, number>(); // a session → its latest ring or clear

export function ring(s: Session): void {
  if (s === store.active && !document.hidden && document.hasFocus()) return;
  const n = (rings.get(s) ?? 0) + 1;
  rings.set(s, n);
  if (s.bell.val && !document.hidden) {
    // A repeated bell restarts the pulse: off for a drawn frame, then on
    // (unless it was cleared, or rang again, meanwhile).
    s.bell.val = false;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (rings.get(s) !== n) return;
        s.bell.val = true;
        updateBadge();
      }),
    );
    return;
  }
  s.bell.val = true;
  updateBadge();
}

export function clearBell(s: Session | null): void {
  if (!s) return;
  rings.set(s, (rings.get(s) ?? 0) + 1);
  if (!s.bell.val) return;
  s.bell.val = false;
  updateBadge();
}

export function updateBadge(): void {
  const ringing = store.sessions.filter((x) => x.bell.val).length;
  favicon().href = ringing ? FAVICON_BELL : FAVICON;
  const name = store.active?.name.val ?? 'tabsh';
  document.title = ringing ? `🔔 ${name}` : name;
}

export function initBell(): void {
  // Coming back to the browser tab counts as seeing the active terminal.
  const seen = () => !document.hidden && clearBell(store.active);
  document.addEventListener('visibilitychange', seen);
  addEventListener('focus', seen);
  favicon().href = FAVICON;
}
