// Every key press in the app sounds, wherever focus is: a terminal, the
// editor, the palette, a dialog's fields. App shortcuts (palette, tab
// switching) and lone modifiers stay silent. The pack played is the one on
// screen, so the palette's typing-sound preview is heard as you type.
import { matchesKey } from '../settings/keys.ts';
import { current, KEYBINDINGS, onApply, onSaved } from '../settings/settings.ts';
import { keySound, loadPack, playSample, SOUND_PACKS } from './packs.ts';

const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock']);
const held = new Map<string, AudioBuffer>(); // e.code → release sample

const isShortcut = (e: KeyboardEvent) =>
  (Object.keys(KEYBINDINGS) as (keyof typeof KEYBINDINGS)[]).some((id) => matchesKey(e, current.saved[id]));

export function initTypingSound(): void {
  window.addEventListener(
    'keydown',
    (e) => {
      // Held keys auto-repeat; only the first press sounds.
      const pack = current.applied.typingSound;
      if (pack === 'off' || e.repeat || MODIFIERS.has(e.key) || isShortcut(e)) return;
      const release = keySound(pack, e.key);
      if (release) held.set(e.code, release);
    },
    { capture: true },
  );
  window.addEventListener(
    'keyup',
    (e) => {
      const release = held.get(e.code);
      held.delete(e.code);
      if (release) playSample(release);
    },
    { capture: true },
  );
  // Fetch the pack now, saved or previewed, so the first keystroke isn't silent.
  const preload = (s: { typingSound: string }) => {
    if (SOUND_PACKS[s.typingSound]) loadPack(s.typingSound).catch(() => {});
  };
  onSaved(preload);
  onApply(preload);
}
