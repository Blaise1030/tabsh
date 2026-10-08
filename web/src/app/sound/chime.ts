// The chimes a card's notification plays (board/notify.ts), synthesized, and
// picked in the palette for Needs input and for Completed (by default a
// rising two-note ping when an agent needs you, a bright three-note arpeggio
// when it's done). Browsers start audio only after a gesture in the page, so
// the context is made (or resumed) on the first click or key; after that it
// plays with the page in the background too.
import type { Status } from '../board/model.ts';
import { current } from '../settings/settings.ts';

interface Chime {
  notes: [number, number][]; // each note's frequency (Hz) and when it starts (s after the first)
  wave?: OscillatorType; // a bell (a sine with a quieter octave) if unset
  fade?: number; // s to fade out
}

// The ids are CARD_SOUNDS's (settings/catalog.ts); 'off' has none.
const CHIMES: Record<string, Chime> = {
  ping: {
    notes: [
      [659.25, 0], // E5
      [987.77, 0.14], // B5
    ],
  },
  arpeggio: {
    notes: [
      [523.25, 0], // C5
      [659.25, 0.1], // E5
      [783.99, 0.2], // G5
      [1046.5, 0.3], // C6
    ],
  },
  ding: { notes: [[1567.98, 0]], fade: 1.4 }, // G6
  pop: { notes: [[620, 0]], wave: 'triangle', fade: 0.09 },
  marimba: {
    notes: [
      [523.25, 0], // C5
      [659.25, 0.1], // E5
      [783.99, 0.2], // G5
    ],
    wave: 'triangle',
    fade: 0.4,
  },
  blip: {
    notes: [
      [990, 0],
      [990, 0.11],
    ],
    wave: 'square',
    fade: 0.07,
  },
};

let audio: AudioContext | null = null;

function unlock(): void {
  audio ??= new AudioContext();
  if (audio.state !== 'running') audio.resume().catch(() => {});
}

// One note: a quick attack and a fade. A bell is a sine with a quieter
// octave above it; a square wave is kept quieter, as it sounds louder.
function note(ctx: AudioContext, out: AudioNode, chime: Chime, freq: number, at: number): void {
  const fade = chime.fade ?? 0.9;
  const voices: [number, number][] = chime.wave
    ? [[1, chime.wave === 'square' ? 0.05 : 0.22]]
    : [
        [1, 0.22],
        [2, 0.06],
      ];
  for (const [mult, level] of voices) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = chime.wave ?? 'sine';
    osc.frequency.value = freq * mult;
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(level, at + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + fade);
    osc.connect(gain).connect(out);
    osc.start(at);
    osc.stop(at + fade + 0.05);
  }
}

// Plays a chime by its id; 'off' (or an unknown id) is silent.
export function previewChime(id: string): void {
  const chime = CHIMES[id];
  if (!chime || !audio) return; // no gesture yet: the page may not play sound
  if (audio.state !== 'running') audio.resume().catch(() => {});
  const out = audio.createGain();
  out.gain.value = 0.8;
  out.connect(audio.destination);
  const t = audio.currentTime + 0.02;
  for (const [freq, after] of chime.notes) note(audio, out, chime, freq, t + after);
}

// The chime chosen for a status, if it has one.
export function playChime(status: Status): void {
  if (status === 'needs_input') previewChime(current.saved.needsInputSound);
  else if (status === 'completed') previewChime(current.saved.completedSound);
}

export function initChime(): void {
  for (const type of ['pointerdown', 'keydown'] as const) addEventListener(type, unlock, { capture: true });
}
