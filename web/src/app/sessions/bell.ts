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

export function ring(s: Session): void {
  if (s === store.active && !document.hidden && document.hasFocus()) return;
  s.bell = true;
  s.tab.classList.remove('bell');
  void s.tab.offsetWidth; // restart the pulse on repeated bells
  s.tab.classList.add('bell');
  updateBadge();
}

export function clearBell(s: Session | null): void {
  if (!s?.bell) return;
  s.bell = false;
  s.tab.classList.remove('bell');
  updateBadge();
}

export function updateBadge(): void {
  const ringing = store.sessions.filter((x) => x.bell).length;
  favicon().href = ringing ? FAVICON_BELL : FAVICON;
  const name = store.active?.name ?? 'tabsh';
  document.title = ringing ? `🔔 ${name}` : name;
}

export function initBell(): void {
  // Coming back to the browser tab counts as seeing the active terminal.
  const seen = () => !document.hidden && clearBell(store.active);
  document.addEventListener('visibilitychange', seen);
  addEventListener('focus', seen);
  favicon().href = FAVICON;
}
