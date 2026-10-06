// The command palette (Basecoat command-dialog): settings with live
// preview, recording a keybinding, the keybindings that open it and switch
// tabs, and the settings button.
import { toggleBoard } from '../board/view.ts';
import { searchFiles, toggleExplorer } from '../explorer/explorer.ts';
import { loadedPane } from '../files/open.ts';
import { cycleTab, store } from '../sessions/store.ts';
import {
  filterChoices,
  filterCurrentLabel,
  filterIsCurrent,
  previewFilter,
  revertFilter,
  setFilter,
} from '../sessions/tags.ts';
import { comboFromEvent, comboProblem, type KeyId, keyLabel, matchesKey } from '../settings/keys.ts';
import type { Settings } from '../settings/schema.ts';
import { applySettings, current, saveSetting, setPreviewing } from '../settings/settings.ts';
import { previewSound } from '../sound/packs.ts';
import { openAbout } from '../ui/about.ts';
import { isMac } from '../ui/dom.ts';
import { CHECK, type PaletteItem, pages } from './pages.ts';

const palette = document.getElementById('palette') as HTMLDialogElement;
const paletteCmd = document.getElementById('palette-command') as HTMLElement & { refresh?: () => void };
const paletteInput = document.getElementById('palette-input') as HTMLInputElement;
const paletteMenu = document.getElementById('palette-menu') as HTMLElement;
let page = 'root';
let recording: KeyId | null = null; // the keybinding the next key press sets
const itemsById = new Map<string, PaletteItem>();

function showPage(name: string): void {
  page = name;
  recording = null;
  const active = store.active;
  const { placeholder, groups } = pages({
    hasFile: !!active && !!loadedPane()?.hasFile(active.id),
    closeFile: () => active && loadedPane()?.close(active.id),
    openAbout,
    toggleExplorer,
    toggleBoard: () => toggleBoard(),
    searchFiles,
    filters: {
      choices: filterChoices,
      currentLabel: filterCurrentLabel,
      isCurrent: filterIsCurrent,
      preview: previewFilter,
      set: setFilter,
    },
  })[name]();
  paletteInput.value = '';
  paletteInput.placeholder = name === 'root' ? placeholder : `${placeholder}  (Esc to go back)`;
  itemsById.clear();
  let n = 0;
  // Every string here is the app's own (labels, hints, theme colours).
  paletteMenu.innerHTML = groups
    .map(
      (g, gi) => `
    <div role="group" aria-labelledby="pg-${gi}">
      <span role="heading" id="pg-${gi}">${g.heading}</span>
      ${g.items
        .map((item) => {
          const id = `pi-${n++}`;
          itemsById.set(id, item);
          const checked = (item.key && current.saved[item.key] === item.value) || item.checked;
          const swatch = item.swatch
            ? `<span class="swatch" style="background:${item.swatch.background}">${(
                ['red', 'green', 'yellow', 'blue', 'magenta'] as const
              )
                .map((c) => `<i style="background:${item.swatch?.[c]}"></i>`)
                .join('')}</span>`
            : '';
          return `<div role="menuitem" id="${id}" data-filter="${item.label}" data-keywords="${item.keywords ?? ''}"
                     ${item.go || item.record ? 'data-keep-command-open' : ''} ${checked ? 'data-checked="true"' : ''}>
          ${item.icon ?? swatch}<span>${item.label}</span>
          ${item.hint ? `<span data-shortcut>${item.hint}</span>` : ''}
          ${item.key || item.checked ? `<span data-indicator>${CHECK}</span>` : ''}
        </div>`;
        })
        .join('')}
    </div>`,
    )
    .join('');
  paletteCmd.refresh?.();
  // Start on the current choice rather than the first entry.
  const chosen = paletteMenu.querySelector('[data-checked="true"]');
  if (chosen) {
    chosen.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    chosen.scrollIntoView({ block: 'nearest' });
  }
  if (name === 'root') applySettings(current.saved);
  paletteInput.focus();
  updatePaletteFades();
}

function startRecording(id: KeyId): void {
  recording = id;
  paletteInput.value = '';
  paletteInput.placeholder = 'Press the new shortcut…  (Esc to cancel)';
  paletteInput.focus();
}

// While recording, every key press is the palette's: Esc cancels, a lone
// modifier waits for the rest, and anything else is saved or explained.
function recordKey(e: KeyboardEvent): void {
  if (!recording || !palette.open) return;
  e.preventDefault(); // also stops Escape from closing the dialog
  e.stopImmediatePropagation(); // capture phase: keep it from the palette's own keys and the terminal
  if (e.key === 'Escape' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
    showPage(recording);
    return;
  }
  const combo = comboFromEvent(e);
  if (!combo) return;
  const problem = comboProblem(combo, recording, current.saved, isMac);
  if (problem) {
    paletteInput.placeholder = `${problem}. Try another  (Esc to cancel)`;
    return;
  }
  const id = recording;
  saveSetting(id, combo);
  showPage(id);
}

// Fade whichever end of the list has items scrolled out of view.
function updatePaletteFades(): void {
  const end = paletteMenu.scrollHeight - paletteMenu.clientHeight;
  paletteMenu.classList.toggle('fade-top', paletteMenu.scrollTop > 1);
  paletteMenu.classList.toggle('fade-bottom', paletteMenu.scrollTop < end - 1);
}

export function openPalette(at: string = 'root'): void {
  if (palette.open) {
    palette.close();
    return;
  }
  (document.getElementById('about') as HTMLDialogElement).close();
  palette.showModal();
  setPreviewing(true);
  showPage(at);
}

// The filter button and its keybinding: the palette straight on its filter
// page, closed again when it is already there.
export function openFilterPalette(): void {
  if (palette.open) {
    if (page === 'filterTabs') palette.close();
    else showPage('filterTabs');
    return;
  }
  openPalette('filterTabs');
}

export function initPalette(): void {
  paletteMenu.addEventListener('scroll', updatePaletteFades, { passive: true });
  // Filtering hides items after this handler's turn; measure once it has.
  paletteInput.addEventListener('input', () => requestAnimationFrame(updatePaletteFades));
  new ResizeObserver(updatePaletteFades).observe(paletteMenu);

  // Live preview: whatever setting is highlighted (keyboard or mouse) is shown,
  // or for typing sounds, heard once per highlight — and a filter choice is
  // previewed on the strip the same way.
  let previewed: PaletteItem | undefined;
  new MutationObserver(() => {
    const item = itemsById.get(paletteMenu.querySelector('[role="menuitem"].active')?.id ?? '');
    if (palette.open && item?.key) applySettings({ ...current.saved, [item.key]: item.value } as Settings);
    if (palette.open && item?.key === 'typingSound' && item !== previewed) previewSound(String(item.value));
    if (palette.open && item?.preview) item.preview();
    previewed = item;
  }).observe(paletteMenu, { subtree: true, attributes: true, attributeFilter: ['class'] });

  // Runs before Basecoat's own click handler, which then closes the dialog
  // unless the item is marked data-keep-command-open.
  paletteMenu.addEventListener('click', (e) => {
    const el = (e.target as Element).closest('[role="menuitem"]');
    const item = el && el.getAttribute('aria-hidden') !== 'true' ? itemsById.get(el.id) : undefined;
    if (!item) return;
    if (item.go) showPage(item.go);
    else if (item.record) startRecording(item.record);
    else if (item.key) saveSetting(item.key, item.value as never);
    else item.run?.();
  });

  paletteInput.addEventListener('keydown', (e) => {
    const back = e.key === 'Escape' || (e.key === 'Backspace' && !paletteInput.value);
    if (back && page !== 'root') {
      e.preventDefault(); // also stops Escape from closing the dialog
      showPage('root');
    }
  });

  // Closing without picking reverts any preview.
  palette.addEventListener('close', () => {
    recording = null;
    setPreviewing(false);
    applySettings(current.saved);
    revertFilter();
    store.active?.term.focus();
  });
  // Clicking the backdrop closes it.
  palette.addEventListener('click', (e) => {
    if (e.target === palette) palette.close();
  });

  // Added first, so a key being recorded never reaches the listeners below.
  window.addEventListener('keydown', recordKey, true);
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

  // The filter keybinding opens the palette straight on its filter page.
  window.addEventListener(
    'keydown',
    (e) => {
      if (palette.open) return;
      if (!matchesKey(e, current.saved.keyFilterTabs)) return;
      e.preventDefault();
      e.stopPropagation(); // capture phase: keep it away from the terminal
      openFilterPalette();
    },
    true,
  );

  const settingsBtn = document.getElementById('settings-btn') as HTMLButtonElement;
  // Set on hover so it always shows the current keybinding.
  settingsBtn.addEventListener('pointerenter', () => {
    settingsBtn.title = `Settings (${keyLabel(current.saved.keyPalette, isMac)})`;
  });
  settingsBtn.onclick = () => openPalette();

  // The filter button beside it opens the palette on the filter page.
  (document.getElementById('tab-filter-btn') as HTMLButtonElement).onclick = openFilterPalette;
}
