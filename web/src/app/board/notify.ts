// Desktop notifications when an agent moves a card to Needs input or
// Completed (a hook's change, heard on the board events socket). A move made
// on the board doesn't notify, nor does one for the terminal on screen in a
// focused window. Clicking one shows that card's terminal. The browser asks
// for permission on the first click in the page (it won't ask unprompted).
import { go } from '../nav/router.ts';
import { type Session, store } from '../sessions/store.ts';
import type { Status } from './model.ts';
import { drawer, shown } from './view.ts';

const SAYS: Partial<Record<Status, string>> = { needs_input: 'Needs your input', completed: 'Completed' };

const supported = () => typeof Notification !== 'undefined';

// Whether `s`'s terminal is what the user is looking at.
const onScreen = (s: Session) => document.hasFocus() && store.active === s && (!shown.val || drawer.val);

export function notifyStatus(s: Session, status: Status, note: string | null): void {
  const says = SAYS[status];
  if (!says || !supported() || Notification.permission !== 'granted' || onScreen(s)) return;
  // One per card: a newer one replaces it.
  const n = new Notification(s.name.val, { body: note ? `${says}: ${note}` : says, tag: `tabsh-card-${s.id}` });
  n.onclick = () => {
    window.focus();
    go(shown.val ? { tab: s.id, drawer: true } : { tab: s.id });
    n.close();
  };
}

export function initNotify(): void {
  if (!supported() || Notification.permission !== 'default') return;
  addEventListener('pointerdown', () => void Notification.requestPermission().catch(() => {}), { once: true });
}
