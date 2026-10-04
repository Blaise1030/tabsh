// Typing sound packs: sampled switch packs from kbsim and Mechvibes (MIT, see
// public/sounds/*/LICENSE), laid out as in keyboardsounds' profiles: five
// press variants for ordinary keys, picked at random, and their own
// press/release for the big keys. A null release means press-only samples.

interface Sample {
  press: AudioBuffer;
  release: AudioBuffer | null;
}
interface Pack {
  keys: Sample[];
  space?: Sample;
  enter?: Sample;
  back?: Sample;
}

export const SOUND_PACKS: Record<string, { release: string | null; special: ('space' | 'enter' | 'back')[] }> = {
  'mx-black-pbt': { release: null, special: ['space', 'enter', 'back'] },
  'mx-blue': { release: 'release', special: [] },
  'holy-panda': { release: 'release_key', special: ['space', 'enter', 'back'] },
  'gateron-black-ink': { release: 'release_key', special: ['space', 'enter', 'back'] },
};
const SPECIAL_KEYS: Record<string, 'space' | 'enter' | 'back'> = {
  ' ': 'space',
  Enter: 'enter',
  Backspace: 'back',
  Delete: 'back',
};

let audio: AudioContext | null = null;
let sampleGain: GainNode | null = null;
const packLoads: Record<string, Promise<Pack>> = {};
const loadedPacks: Record<string, Pack> = {};

export function loadPack(id: string): Promise<Pack> {
  if (id in packLoads) return packLoads[id];
  // Decoding needs a context but not a user gesture; it may start suspended.
  audio ??= new AudioContext();
  const ctx = audio;
  const { release, special } = SOUND_PACKS[id];
  const buffer = (name: string) =>
    fetch(`/sounds/${id}/${name}.mp3`)
      .then((res) => {
        if (!res.ok) throw new Error(res.statusText);
        return res.arrayBuffer();
      })
      .then((data) => ctx.decodeAudioData(data));
  const keyRelease = release ? buffer(release) : null;
  const sample = async (press: string, rel: Promise<AudioBuffer> | null): Promise<Sample> => ({
    press: await buffer(press),
    release: await rel,
  });
  packLoads[id] = Promise.all([
    Promise.all([1, 2, 3, 4, 5].map((n) => sample(`press_key${n}`, keyRelease))),
    ...special.map((s) => sample(`press_${s}`, release ? buffer(`release_${s}`) : null)),
  ])
    .then(([keys, ...rest]) => {
      loadedPacks[id] = { keys: keys as Sample[], ...Object.fromEntries(special.map((s, i) => [s, rest[i]])) };
      return loadedPacks[id];
    })
    .catch((err) => {
      delete packLoads[id]; // let a later keystroke retry
      throw err;
    });
  return packLoads[id];
}

export function playSample(buf: AudioBuffer): void {
  if (!audio) return;
  if (audio.state === 'suspended') audio.resume().catch(() => {});
  if (!sampleGain) {
    sampleGain = audio.createGain();
    sampleGain.gain.value = 0.6;
    sampleGain.connect(audio.destination);
  }
  const src = audio.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = 0.95 + Math.random() * 0.1;
  src.connect(sampleGain);
  src.start();
}

// The pack's sample for a key, or null while the pack is still loading.
function sampleFor(id: string, key: string): Sample | null {
  const pack = loadedPacks[id];
  if (!pack) {
    loadPack(id).catch(() => {});
    return null;
  }
  return pack[SPECIAL_KEYS[key]] ?? pack.keys[Math.floor(Math.random() * pack.keys.length)];
}

// Lets the palette play a sound while it's highlighted, so you hear a
// pack before choosing it.
export function previewSound(setting: string): void {
  if (SOUND_PACKS[setting] && !loadedPacks[setting]) {
    loadPack(setting).then(
      () => previewSound(setting),
      () => {},
    );
    return;
  }
  const release = keySound(setting, 'a');
  if (release) setTimeout(() => playSample(release), 90);
}

// Plays a sound for one key under the given setting; returns the release
// sample to play when the key comes back up, if any.
export function keySound(setting: string, key: string): AudioBuffer | null {
  const sample = SOUND_PACKS[setting] ? sampleFor(setting, key) : null;
  if (!sample) return null;
  playSample(sample.press);
  return sample.release;
}
