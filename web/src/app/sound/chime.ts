// The chimes a card's notification plays (board/notify.ts), synthesized: a
// rising two-note ping when an agent needs you, a bright three-note arpeggio
// when it's done. Browsers start audio only after a gesture in the page, so
// the context is made (or resumed) on the first click or key; after that it
// plays with the page in the background too.
import type { Status } from '../board/model.ts';

// Each note: its frequency (Hz) and when it starts (s after the first).
const CHIMES: Partial<Record<Status, [number, number][]>> = {
  needs_input: [
    [659.25, 0], // E5
    [987.77, 0.14], // B5
  ],
  completed: [
    [523.25, 0], // C5
    [659.25, 0.1], // E5
    [783.99, 0.2], // G5
    [1046.5, 0.3], // C6
  ],
};

let audio: AudioContext | null = null;

function unlock(): void {
  audio ??= new AudioContext();
  if (audio.state !== 'running') audio.resume().catch(() => {});
}

// A soft bell: a sine with a quieter octave above it, a quick attack and a
// long fade.
function bell(ctx: AudioContext, out: AudioNode, freq: number, at: number): void {
  for (const [mult, level] of [
    [1, 0.22],
    [2, 0.06],
  ] as const) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq * mult;
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(level, at + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.9);
    osc.connect(gain).connect(out);
    osc.start(at);
    osc.stop(at + 0.95);
  }
}

export function playChime(status: Status): void {
  const notes = CHIMES[status];
  if (!notes || !audio) return; // no gesture yet: the page may not play sound
  if (audio.state !== 'running') audio.resume().catch(() => {});
  const out = audio.createGain();
  out.gain.value = 0.8;
  out.connect(audio.destination);
  const t = audio.currentTime + 0.02;
  for (const [freq, after] of notes) bell(audio, out, freq, t + after);
}

export function initChime(): void {
  for (const type of ['pointerdown', 'keydown'] as const) addEventListener(type, unlock, { capture: true });
}
