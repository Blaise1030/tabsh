// Typing in a terminal sounds, and so does typing in the file pane's editor
// (not a read-only view of the file). App shortcuts (palette, tab
// switching) stay silent.
import { matchesKey } from '../settings/keys.ts';
import { current, KEYBINDINGS, onSaved } from '../settings/settings.ts';
import { keySound, loadPack, playSample, SOUND_PACKS } from './packs.ts';

const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock']);
const held = new Map<string, AudioBuffer>(); // e.code → release sample

const typing = (e: KeyboardEvent) =>
  !!(e.target as Element | null)?.closest?.('#terms, #pane .cm-content[contenteditable="true"]') &&
  !(Object.keys(KEYBINDINGS) as (keyof typeof KEYBINDINGS)[]).some((id) => matchesKey(e, current.saved[id]));

export function initTypingSound(): void {
  window.addEventListener(
    'keydown',
    (e) => {
      // Held keys auto-repeat; only the first press sounds.
      if (current.saved.typingSound === 'off' || e.repeat || MODIFIERS.has(e.key) || !typing(e)) return;
      const release = keySound(current.saved.typingSound, e.key);
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
  // Fetch the chosen pack now so the first keystroke isn't silent.
  onSaved((s) => {
    if (SOUND_PACKS[s.typingSound]) loadPack(s.typingSound).catch(() => {});
  });
}
