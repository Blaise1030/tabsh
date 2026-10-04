// @ts-nocheck
// biome-ignore-all lint: moved verbatim from the page's inline script; typed and split up in Tasks 9 to 11
// The app page's script: tabs and terminals, links and the file pane, settings,
// the command palette, sounds and drag-and-drop.

import { api, daemonFetch, initGate, socketUrl, waitForDaemon } from './daemon/client.ts';
import { LOCAL_APP, MIXED_BLOCKED } from './daemon/config.ts';
import { adoptToken } from './daemon/token.ts';
import { initFilePane, loadedPane } from './files/open.ts';
import { initBell } from './sessions/bell.ts';
import {
  activate,
  closeSession,
  cycleTab,
  newSession,
  newTabAt,
  savedActive,
  sendSize,
  store,
  sync,
} from './sessions/store.ts';
import { initTabStrip } from './sessions/tabs.ts';
import { FONT_SIZES, FONTS, prefersLight, THEMES, TYPING_SOUNDS } from './settings/catalog.ts';
import { keyLabel, matchesKey } from './settings/keys.ts';
import {
  applySettings,
  current,
  KEYBINDINGS,
  loadSettings,
  onApply,
  onSaved,
  saveSetting,
  setPreviewing,
  terminalOptions,
} from './settings/settings.ts';
import { isMac } from './ui/dom.ts';

// The pairing link puts the token in the fragment; take it and clear it
// before anything talks to the daemon.
const launched = adoptToken(location.hash);
if (location.hash) history.replaceState(null, '', location.pathname + location.search);
// A link with the token comes from a running daemon (it opens one at
// startup), so it's safe to go straight to its copy. Without one the
// daemon may be down, and the gate explains how to start it.
if (MIXED_BLOCKED && launched) location.replace(LOCAL_APP);
initGate();

// What the file pane needs from the rest of the page.
initFilePane(
  {
    fetch: daemonFetch,
    theme() {
      const t = THEMES[current.applied.theme];
      const c = t.colors;
      return {
        background: c.background,
        foreground: c.foreground,
        cursor: c.cursor,
        selectionBackground: c.selectionBackground,
        light: !!t.light,
      };
    },
    layout: () => store.active && sendSize(store.active),
    newTabAt,
    focusTerminal: () => store.active?.term.focus(),
  },
  () => store.active?.id ?? null,
);
addEventListener('beforeunload', (e) => {
  if (!loadedPane()?.hasUnsaved()) return;
  e.preventDefault();
  e.returnValue = ''; // older browsers
});
initBell();
initTabStrip();

// ---- Typing sound --------------------------------------------------------
let audio = null;
// Sampled switch packs from kbsim and Mechvibes (MIT, see
// public/sounds/*/LICENSE), laid out as in keyboardsounds' profiles: five
// press variants for ordinary keys, picked at random, and their own
// press/release for the big keys. A null release means press-only samples.
const SOUND_PACKS = {
  'mx-black-pbt': { release: null, special: ['space', 'enter', 'back'] },
  'mx-blue': { release: 'release', special: [] },
  'holy-panda': { release: 'release_key', special: ['space', 'enter', 'back'] },
  'gateron-black-ink': { release: 'release_key', special: ['space', 'enter', 'back'] },
};
const SPECIAL_KEYS = { ' ': 'space', Enter: 'enter', Backspace: 'back', Delete: 'back' };
const packLoads = {}; // id → Promise of the decoded pack
const loadedPacks = {}; // id → { keys: [{ press, release }], space?, enter?, back? }
let sampleGain = null;

function loadPack(id) {
  if (packLoads[id]) return packLoads[id];
  // Decoding needs a context but not a user gesture; it may start suspended.
  audio ??= new AudioContext();
  const { release, special } = SOUND_PACKS[id];
  const buffer = (name) =>
    fetch(`/sounds/${id}/${name}.mp3`)
      .then((res) => {
        if (!res.ok) throw new Error(res.statusText);
        return res.arrayBuffer();
      })
      .then((data) => audio.decodeAudioData(data));
  const keyRelease = release && buffer(release);
  const sample = async (press, rel) => ({ press: await buffer(press), release: await rel });
  return (packLoads[id] = Promise.all([
    Promise.all([1, 2, 3, 4, 5].map((n) => sample(`press_key${n}`, keyRelease))),
    ...special.map((s) => sample(`press_${s}`, release && buffer(`release_${s}`))),
  ])
    .then(([keys, ...rest]) => {
      loadedPacks[id] = { keys, ...Object.fromEntries(special.map((s, i) => [s, rest[i]])) };
      return loadedPacks[id];
    })
    .catch((err) => {
      delete packLoads[id]; // let a later keystroke retry
      throw err;
    }));
}

function playSample(buf) {
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
function sampleFor(id, key) {
  const pack = loadedPacks[id];
  if (!pack) {
    loadPack(id).catch(() => {});
    return null;
  }
  return pack[SPECIAL_KEYS[key]] ?? pack.keys[Math.floor(Math.random() * pack.keys.length)];
}

// Lets the palette play a sound while it's highlighted, so you hear a
// pack before choosing it.
function previewSound(setting) {
  if (SOUND_PACKS[setting] && !loadedPacks[setting]) {
    return loadPack(setting).then(
      () => previewSound(setting),
      () => {},
    );
  }
  const release = keySound(setting, 'a');
  if (release) setTimeout(() => playSample(release), 90);
}

// Plays a sound for one key under the given setting; returns the release
// sample to play when the key comes back up, if any.
function keySound(setting, key) {
  const sample = SOUND_PACKS[setting] && sampleFor(setting, key);
  if (!sample) return null;
  playSample(sample.press);
  return sample.release;
}

const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock']);
const held = new Map(); // e.code → release sample
// Typing in a terminal sounds, and so does typing in the file pane's editor
// (not a read-only view of the file).
// App shortcuts (palette, tab switching) stay silent.
const typing = (e) =>
  !!e.target.closest?.('#terms, #pane .cm-content[contenteditable="true"]') &&
  !Object.keys(KEYBINDINGS).some((id) => matchesKey(e, current.saved[id]));
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

// ---- Command palette (Basecoat command-dialog) --------------------------

const palette = document.getElementById('palette');
const paletteCmd = document.getElementById('palette-command');
const paletteInput = document.getElementById('palette-input');
const paletteMenu = document.getElementById('palette-menu');
let page = 'root';

const CHECK =
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
const ICONS = {
  theme:
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z"/><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/></svg>',
  font: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v16"/><path d="M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2"/><path d="M9 20h6"/></svg>',
  size: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 16 2.536-7.328a1.02 1.02 1 0 1 1.928 0L22 16"/><path d="M15.697 14h5.606"/><path d="m2 16 4.039-9.69a.5.5 0 0 1 .923 0L11 16"/><path d="M3.304 13h6.392"/></svg>',
  sound:
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 8h.01"/><path d="M12 12h.01"/><path d="M14 8h.01"/><path d="M16 12h.01"/><path d="M18 8h.01"/><path d="M6 8h.01"/><path d="M7 16h10"/><path d="M8 12h.01"/><rect width="20" height="16" x="2" y="4" rx="2"/></svg>',
  keybinding:
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3"/></svg>',
  info: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>',
};

// Each page is a list of groups; an item either opens another page (`go`),
// picks a setting (`key` + `value`, previewed while highlighted) or runs code.
const PAGES = {
  root: () => ({
    placeholder: `Search settings…`,
    groups: [
      {
        heading: 'Appearance',
        items: [
          {
            label: 'Theme…',
            icon: ICONS.theme,
            hint: THEMES[current.saved.theme].name,
            keywords: 'color colour scheme dark light',
            go: 'theme',
          },
          {
            label: 'Font…',
            icon: ICONS.font,
            hint: FONTS[current.saved.font].name,
            keywords: 'typeface family',
            go: 'font',
          },
          {
            label: 'Font size…',
            icon: ICONS.size,
            hint: `${current.saved.fontSize}px`,
            keywords: 'zoom text bigger smaller',
            go: 'fontSize',
          },
        ],
      },
      {
        heading: 'Sound',
        items: [
          {
            label: 'Typing sound…',
            icon: ICONS.sound,
            hint: TYPING_SOUNDS[current.saved.typingSound],
            keywords: 'keyboard click clack audio mute',
            go: 'typingSound',
          },
        ],
      },
      ...(store.active && loadedPane()?.hasFile(store.active.id)
        ? [
            {
              heading: 'Files',
              items: [
                {
                  label: 'Close file',
                  icon: ICONS.info,
                  keywords: 'pane editor hide',
                  run: () => loadedPane()?.close(store.active.id),
                },
              ],
            },
          ]
        : []),
      {
        heading: 'Keybindings',
        items: Object.entries(KEYBINDINGS).map(([id, k]) => ({
          label: `${k.name}…`,
          icon: ICONS.keybinding,
          hint: keyLabel(current.saved[id], isMac),
          keywords: `shortcut hotkey keybinding keyboard ${k.keywords} ${keyLabel(current.saved[id], isMac, true)}`,
          go: id,
        })),
      },
      {
        heading: 'Help',
        items: [{ label: 'About tabsh', icon: ICONS.info, keywords: 'version info', run: openAbout }],
      },
    ],
  }),
  theme: () => {
    const item = ([id, t]) => ({ label: t.name, key: 'theme', value: id, swatch: t.colors });
    const entries = Object.entries(THEMES);
    return {
      placeholder: 'Search themes…',
      groups: [
        { heading: 'System', items: entries.filter(([, t]) => t.system).map(item) },
        { heading: 'Dark', items: entries.filter(([, t]) => !t.system && !t.light).map(item) },
        { heading: 'Light', items: entries.filter(([, t]) => !t.system && t.light).map(item) },
      ],
    };
  },
  font: () => ({
    placeholder: 'Search fonts…',
    groups: [
      {
        heading: 'Font',
        items: Object.entries(FONTS).map(([id, f]) => ({
          label: f.name,
          key: 'font',
          value: id,
          hint: f.google ? 'Google Fonts' : 'System',
        })),
      },
    ],
  }),
  typingSound: () => ({
    placeholder: 'Search…',
    groups: [
      {
        heading: 'Typing sound',
        items: Object.entries(TYPING_SOUNDS).map(([id, name]) => ({ label: name, key: 'typingSound', value: id })),
      },
    ],
  }),
  fontSize: () => ({
    placeholder: 'Search sizes…',
    groups: [{ heading: 'Font size', items: FONT_SIZES.map((n) => ({ label: `${n}px`, key: 'fontSize', value: n })) }],
  }),
  ...Object.fromEntries(
    Object.entries(KEYBINDINGS).map(([id, k]) => [
      id,
      () => ({
        placeholder: 'Search shortcuts…',
        groups: [
          {
            heading: k.name,
            items: k.presets.map((combo) => ({
              label: keyLabel(combo, isMac),
              key: id,
              value: combo,
              keywords: keyLabel(combo, isMac, true),
            })),
          },
        ],
      }),
    ]),
  ),
};

const itemsById = new Map();
function showPage(name) {
  page = name;
  const { placeholder, groups } = PAGES[name]();
  paletteInput.value = '';
  paletteInput.placeholder = name === 'root' ? placeholder : `${placeholder}  (Esc to go back)`;
  itemsById.clear();
  let n = 0;
  paletteMenu.innerHTML = groups
    .map(
      (g, gi) => `
    <div role="group" aria-labelledby="pg-${gi}">
      <span role="heading" id="pg-${gi}">${g.heading}</span>
      ${g.items
        .map((item) => {
          const id = `pi-${n++}`;
          itemsById.set(id, item);
          const checked = item.key && current.saved[item.key] === item.value;
          const swatch = item.swatch
            ? `<span class="swatch" style="background:${item.swatch.background}">${[
                'red',
                'green',
                'yellow',
                'blue',
                'magenta',
              ]
                .map((c) => `<i style="background:${item.swatch[c]}"></i>`)
                .join('')}</span>`
            : '';
          return `<div role="menuitem" id="${id}" data-filter="${item.label}" data-keywords="${item.keywords ?? ''}"
                     ${item.go ? 'data-keep-command-open' : ''} ${checked ? 'data-checked="true"' : ''}>
          ${item.icon ?? swatch}<span>${item.label}</span>
          ${item.hint ? `<span data-shortcut>${item.hint}</span>` : ''}
          ${item.key ? `<span data-indicator>${CHECK}</span>` : ''}
        </div>`;
        })
        .join('')}
    </div>`,
    )
    .join('');
  paletteCmd.refresh?.();
  // Start on the current choice rather than the first entry.
  const current = paletteMenu.querySelector('[data-checked="true"]');
  if (current) {
    current.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    current.scrollIntoView({ block: 'nearest' });
  }
  if (name === 'root') applySettings(current.saved);
  paletteInput.focus();
  updatePaletteFades();
}

// Fade whichever end of the list has items scrolled out of view.
function updatePaletteFades() {
  const end = paletteMenu.scrollHeight - paletteMenu.clientHeight;
  paletteMenu.classList.toggle('fade-top', paletteMenu.scrollTop > 1);
  paletteMenu.classList.toggle('fade-bottom', paletteMenu.scrollTop < end - 1);
}
paletteMenu.addEventListener('scroll', updatePaletteFades, { passive: true });
// Filtering hides items after this handler's turn; measure once it has.
paletteInput.addEventListener('input', () => requestAnimationFrame(updatePaletteFades));
new ResizeObserver(updatePaletteFades).observe(paletteMenu);

function openPalette() {
  if (palette.open) return palette.close();
  document.getElementById('about').close();
  palette.showModal();
  setPreviewing(true);
  showPage('root');
}

// Live preview: whatever setting is highlighted (keyboard or mouse) is shown,
// or for typing sounds, heard once per highlight.
let previewed = null;
new MutationObserver(() => {
  const item = itemsById.get(paletteMenu.querySelector('[role="menuitem"].active')?.id);
  if (palette.open && item?.key) applySettings({ ...saved, [item.key]: item.value });
  if (palette.open && item?.key === 'typingSound' && item !== previewed) previewSound(item.value);
  previewed = item;
}).observe(paletteMenu, { subtree: true, attributes: true, attributeFilter: ['class'] });

// Runs before Basecoat's own click handler, which then closes the dialog
// unless the item is marked data-keep-command-open.
paletteMenu.addEventListener('click', (e) => {
  const el = e.target.closest('[role="menuitem"]');
  const item = el && el.getAttribute('aria-hidden') !== 'true' && itemsById.get(el.id);
  if (!item) return;
  if (item.go) showPage(item.go);
  else if (item.key) saveSetting(item.key, item.value);
  else item.run?.();
});

paletteInput.addEventListener('keydown', (e) => {
  const back = e.key === 'Escape' || (e.key === 'Backspace' && !paletteInput.value);
  if (back && page !== 'root') {
    e.preventDefault(); // also stops Escape from closing the dialog
    showPage('root');
  }
});

// Drag the divider to resize the pane. The width is live while dragging and
// saved once on release.
{
  const ws = document.getElementById('workspace'),
    divider = document.getElementById('pane-divider');
  let frac = null,
    frame = 0;
  const widthAt = (x) => {
    const r = ws.getBoundingClientRect();
    return Math.min(0.8, Math.max(0.2, (r.right - x) / r.width));
  };
  divider.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    divider.setPointerCapture(e.pointerId);
    ws.classList.add('dragging');
    frac = widthAt(e.clientX);
  });
  divider.addEventListener('pointermove', (e) => {
    if (frac === null) return;
    frac = widthAt(e.clientX);
    ws.style.setProperty('--pane-width', String(frac));
    frame ||= requestAnimationFrame(() => {
      frame = 0;
      if (store.active) sendSize(store.active);
    });
  });
  const end = (e) => {
    if (frac === null) return;
    const v = frac;
    frac = null;
    ws.classList.remove('dragging');
    if (e.type === 'pointerup') saveSetting('paneWidth', v);
    else applySettings(current.saved); // cancelled: back to the stored width
  };
  divider.addEventListener('pointerup', end);
  divider.addEventListener('pointercancel', end);
}

// Closing without picking reverts any preview.
palette.addEventListener('close', () => {
  setPreviewing(false);
  applySettings(current.saved);
  store.active?.term.focus();
});

window.addEventListener(
  'keydown',
  (e) => {
    if (!matchesKey(e, current.saved.keyPalette)) return;
    e.preventDefault();
    e.stopPropagation(); // capture phase: keep it away from the terminal
    openPalette();
  },
  true,
);

// The next/previous tab keybindings cycle through tabs, wrapping at the ends.
// (Ctrl+Tab and ⌘⇧[ ] belong to the browser and never reach the page.)
window.addEventListener(
  'keydown',
  (e) => {
    if (palette.open) return;
    const step = matchesKey(e, current.saved.keyNextTab) ? 1 : matchesKey(e, current.saved.keyPrevTab) ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    e.stopPropagation(); // capture phase: keep it away from the terminal
    cycleTab(step);
  },
  true,
);

const settingsBtn = document.getElementById('settings-btn');
// Set on hover so it always shows the current keybinding.
settingsBtn.addEventListener('pointerenter', () => {
  settingsBtn.title = `Settings (${keyLabel(current.saved.keyPalette, isMac)})`;
});
settingsBtn.onclick = openPalette;

// ---- About ---------------------------------------------------------------

const about = document.getElementById('about');
about.addEventListener('close', () => store.active?.term.focus());

async function openAbout() {
  const info = await daemonFetch('/api/about')
    .then((r) => r.json())
    .catch(() => null);
  const up = info ? info.uptime_secs : 0;
  const uptime =
    up < 60
      ? `${up}s`
      : up < 3600
        ? `${Math.floor(up / 60)}m`
        : `${Math.floor(up / 3600)}h ${Math.floor((up % 3600) / 60)}m`;
  const rows = info
    ? [
        ['Version', info.version],
        ['Shell', info.shell],
        ['State', info.state_path],
        ['Uptime', uptime],
        ['Sessions', `${info.sessions_running} running, ${info.sessions_total} total`],
        ['Settings', keyLabel(current.saved.keyPalette, isMac)],
        ['Switch tabs', `${keyLabel(current.saved.keyPrevTab, isMac)} / ${keyLabel(current.saved.keyNextTab, isMac)}`],
        ['Built with', 'Rust · axum · xterm.js · Basecoat'],
      ]
    : [['Status', 'Could not reach the tabsh daemon.']];
  const list = document.getElementById('about-list');
  list.replaceChildren(
    ...rows.map(([k, v]) => {
      const tr = document.createElement('tr'),
        th = document.createElement('th'),
        td = document.createElement('td');
      th.scope = 'row';
      th.textContent = k;
      td.textContent = v;
      tr.append(th, td);
      return tr;
    }),
  );
  about.showModal();
}

// ---- Drag and drop -------------------------------------------------------
// Dropping files on the terminal types their paths at the prompt (as a
// paste, so TUIs like Claude Code pick up image paths). Browsers never
// reveal a dropped file's real path, so files are uploaded to the daemon
// first and the saved copy's path is used.

const dropGlow = document.getElementById('drop-glow');
const isDroppable = (dt) => !!dt && ['Files', 'text/uri-list', 'text/plain'].some((t) => dt.types.includes(t));
const shellQuote = (p) => (/^[A-Za-z0-9_@%+=:,.\/-]+$/.test(p) ? p : `'${p.replace(/'/g, `'\\''`)}'`);

async function uploadFile(file) {
  const res = await daemonFetch(`/api/uploads?name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file });
  if (!res.ok) throw new Error(`upload ${file.name}: ${res.status}`);
  return (await res.json()).path;
}

// file:// URLs some apps put on the drag (no upload needed).
function localPaths(dt) {
  return (dt.getData('text/uri-list') || '')
    .split(/\r?\n/)
    .filter((l) => l.startsWith('file://'))
    .map((l) => {
      try {
        return decodeURIComponent(new URL(l).pathname);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

async function textForDrop(dt) {
  const local = localPaths(dt);
  if (local.length) return local.map(shellQuote).join(' ') + ' ';
  const files = [...dt.files];
  if (files.length) {
    const paths = await Promise.all(files.map(uploadFile));
    return paths.map(shellQuote).join(' ') + ' ';
  }
  return dt.getData('text/plain') || '';
}

window.addEventListener('dragenter', (e) => {
  if (isDroppable(e.dataTransfer)) dropGlow.classList.add('active');
});
window.addEventListener('dragover', (e) => {
  if (!isDroppable(e.dataTransfer)) return;
  dropGlow.classList.add('active');
  e.preventDefault(); // allow the drop (and stop the browser opening the file)
  const allowed = e.dataTransfer.effectAllowed;
  e.dataTransfer.dropEffect = allowed === 'move' || allowed === 'link' ? allowed : 'copy';
});
// relatedTarget is null only when the pointer leaves the window.
window.addEventListener('dragleave', (e) => {
  if (!e.relatedTarget) dropGlow.classList.remove('active');
});
window.addEventListener('dragend', () => dropGlow.classList.remove('active'));
window.addEventListener('drop', async (e) => {
  dropGlow.classList.remove('active');
  if (!isDroppable(e.dataTransfer)) return;
  e.preventDefault();
  const target = store.active;
  if (!target) return;
  try {
    const text = await textForDrop(e.dataTransfer);
    if (text && !target.closed) {
      target.term.paste(text);
      target.term.focus();
    }
  } catch (err) {
    console.error(err);
  }
});

document.querySelectorAll('[data-new-session]').forEach((b) => (b.onclick = newSession));
new ResizeObserver(() => store.active && requestAnimationFrame(() => sendSize(store.active))).observe(
  document.getElementById('terms'),
);
window.addEventListener('focus', () => {
  sync().catch(() => {});
  loadSettings().catch(() => {});
});

// Reattach to the server's sessions (shells survive reloads; after a
// daemon restart they come back in their old directory with old output).
// Follow the system's light/dark switch live while the tabsh theme is on.
prefersLight?.addEventListener('change', () => current.applied.theme === 'tabsh' && applySettings(current.applied));

// Applied settings restyle every terminal and the file pane.
onApply((s) => {
  const opts = terminalOptions(s);
  for (const { term } of store.sessions) Object.assign(term.options, opts);
  document.getElementById('workspace').style.setProperty('--pane-width', String(s.paneWidth));
  loadedPane()?.applyTheme();
  if (store.active) sendSize(store.active);
});
// Fetch the chosen pack now so the first keystroke isn't silent.
onSaved((s) => {
  if (SOUND_PACKS[s.typingSound]) loadPack(s.typingSound).catch(() => {});
});

(async () => {
  const activeId = savedActive();
  applySettings(current.saved); // theme the connection screen before the daemon answers
  await waitForDaemon();
  await loadSettings().catch(() => applySettings(current.saved));
  await sync();
  if (!store.sessions.length) return newSession();
  activate(store.sessions.find((s) => s.id === activeId) ?? store.sessions[0]);
})();

// Clicking a dialog's backdrop closes it, and so does the About dialog's button.
for (const id of ['palette', 'about']) {
  const dialog = document.getElementById(id);
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });
}
document
  .querySelector('#about footer button')
  .addEventListener('click', (e) => e.currentTarget.closest('dialog').close());
