// The command palette (Basecoat command-dialog): settings with live
// preview, recording a keybinding, editing a text (agent providers), the
// keybindings that open it and switch tabs, and the settings button.
import van from 'vanjs-core';
import { toggleBoard } from '../board/view.ts';
import { searchFiles, toggleExplorer } from '../explorer/explorer.ts';
import { loadedPane } from '../files/open.ts';
import { back, backPastPalette, forward, go, here, isLeavingPalette, isPaletteEntry, onPlace } from '../nav/router.ts';
import { cycleTab, store } from '../sessions/store.ts';
import { comboFromEvent, comboProblem, type KeyId, keyLabel, matchesKey } from '../settings/keys.ts';
import type { Settings } from '../settings/schema.ts';
import { applySettings, current, saveSetting, setPreviewing } from '../settings/settings.ts';
import { previewSound } from '../sound/packs.ts';
import { openAbout } from '../ui/about.ts';
import { isMac } from '../ui/dom.ts';
import { icons } from '../ui/icons.ts';
import { keyed } from '../ui/keyed.ts';
import { type PaletteItem, pages, type TextEdit } from './pages.ts';

const { div, i, span } = van.tags;

const paletteEl = () => document.getElementById('palette') as HTMLDialogElement;
const paletteCmd = () => document.getElementById('palette-command') as HTMLElement & { refresh?: () => void };
const paletteInput = () => document.getElementById('palette-input') as HTMLInputElement;
const paletteMenu = () => document.getElementById('palette-menu') as HTMLElement;
// The page shown, or null while closed. Only the palette step assigns it.
export const page = van.state<string | null>(null);
let recording: KeyId | null = null; // the keybinding the next key press sets
let editing: TextEdit | null = null; // the text the input holds instead of a search
const itemsById = new Map<string, PaletteItem>();

function palettePages(): ReturnType<typeof pages> {
  const active = store.active;
  return pages({
    hasFile: !!active && !!loadedPane()?.hasFile(active.id),
    closeFile: () => go({ file: null }),
    openAbout,
    toggleExplorer,
    toggleBoard: () => toggleBoard(),
    searchFiles,
    canGoBack: navigation.canGoBack,
    goBack: backPastPalette,
  });
}

// A shown page's groups, each item with its menu id. Every render is new
// (`n`), so a page shown again is built afresh, its checks and hints current.
interface MenuGroup {
  key: string;
  heading: string;
  id: string;
  items: { id: string; item: PaletteItem }[];
}
const menu = van.state<MenuGroup[]>([]);
let renders = 0;

function showPage(name: string): void {
  page.val = name;
  recording = null;
  editing = null;
  paletteMenu().hidden = false;
  const { placeholder, groups } = palettePages()[name]();
  paletteInput().value = '';
  paletteInput().placeholder = name === 'root' ? placeholder : `${placeholder}  (Esc to go back)`;
  const n = renders++;
  let k = 0;
  menu.val = groups.map((g, gi) => ({
    key: `${n}/${name}/${g.heading}`,
    heading: g.heading,
    id: `pg-${gi}`,
    items: g.items.map((item) => ({ id: `pi-${k++}`, item })),
  }));
  if (name === 'root') applySettings(current.saved);
  paletteInput().focus();
}

const SWATCH = ['red', 'green', 'yellow', 'blue', 'magenta'] as const;

function PaletteRow({ id, item }: MenuGroup['items'][number]): HTMLElement {
  const props: Record<string, string> = {
    role: 'menuitem',
    id,
    'data-filter': item.label,
    'data-keywords': item.keywords ?? '',
  };
  if (item.disabled) props['aria-disabled'] = 'true';
  if (item.go || item.record || item.edit || item.disabled) props['data-keep-command-open'] = '';
  if ((item.key && current.saved[item.key] === item.value) || item.checked) props['data-checked'] = 'true';
  const { swatch } = item;
  return div(
    props,
    item.icon?.() ??
      (swatch
        ? span(
            { class: 'swatch', style: `background:${swatch.background}` },
            SWATCH.map((c) => i({ style: `background:${swatch[c]}` })),
          )
        : ''),
    span(item.label),
    item.hint ? span({ 'data-shortcut': '' }, item.hint) : '',
    item.key || item.checked ? span({ 'data-indicator': '' }, icons.check()) : '',
  );
}

function PaletteGroup(g: MenuGroup): HTMLElement {
  return div(
    { role: 'group', 'aria-labelledby': g.id },
    span({ role: 'heading', id: g.id }, g.heading),
    g.items.map(PaletteRow),
  );
}

// After VanJS has put a render on the page: the ids now name its items (until
// then they named the last render's, still on the page); Basecoat's command
// menu caches its items, so it takes the new ones; then the page starts on
// the current choice rather than the first entry.
function afterRender(groups: MenuGroup[]): void {
  itemsById.clear();
  for (const g of groups) for (const { id, item } of g.items) itemsById.set(id, item);
  paletteCmd().refresh?.();
  const chosen = paletteMenu().querySelector('[data-checked="true"]');
  if (chosen) {
    chosen.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    chosen.scrollIntoView({ block: 'nearest' });
  }
  updatePaletteFades();
}

function startRecording(id: KeyId): void {
  recording = id;
  paletteInput().value = '';
  paletteInput().placeholder = 'Press the new shortcut…  (Esc to cancel)';
  paletteInput().focus();
}

// The input holds the text being edited, the menu out of the way.
function startEditing(edit: TextEdit): void {
  editing = edit;
  paletteMenu().hidden = true;
  paletteInput().value = edit.value;
  paletteInput().placeholder = edit.placeholder;
  paletteInput().focus();
  paletteInput().select();
}

// While editing, Enter saves and Esc goes back to the page.
function editKey(e: KeyboardEvent): void {
  if (!editing || !paletteEl().open || e.target !== paletteInput()) return;
  if (e.key !== 'Enter' && e.key !== 'Escape') return;
  e.preventDefault(); // also stops Escape from closing the dialog
  e.stopImmediatePropagation(); // capture phase: keep Enter from picking a menu item
  const at = page.val ?? 'root';
  if (e.key === 'Escape') {
    showPage(at);
    return;
  }
  const result = editing.save(paletteInput().value);
  if ('problem' in result) {
    paletteInput().placeholder = `${result.problem}  (Esc to cancel)`;
    if (!paletteInput().value.trim()) paletteInput().value = '';
    return;
  }
  // The same page again is redrawn in place, with the saved value.
  if (result.next === at) showPage(at);
  else go({ palette: result.next }, 'replace');
}

// While recording, every key press is the palette's: Esc cancels, a lone
// modifier waits for the rest, and anything else is saved or explained.
function recordKey(e: KeyboardEvent): void {
  if (!recording || !paletteEl().open) return;
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
    paletteInput().placeholder = `${problem}. Try another  (Esc to cancel)`;
    return;
  }
  const id = recording;
  saveSetting(id, combo);
  showPage(id);
}

// Fade whichever end of the list has items scrolled out of view.
function updatePaletteFades(): void {
  const end = paletteMenu().scrollHeight - paletteMenu().clientHeight;
  paletteMenu().classList.toggle('fade-top', paletteMenu().scrollTop > 1);
  paletteMenu().classList.toggle('fade-bottom', paletteMenu().scrollTop < end - 1);
}

// The palette step's half: open on `at`, or closed. It never navigates.
function showPalette(at: string | null): void {
  if (!at) {
    page.val = null;
    if (paletteEl().open) paletteEl().close();
    return;
  }
  if (!paletteEl().open) {
    (document.getElementById('about') as HTMLDialogElement).close();
    paletteEl().showModal();
    setPreviewing(true);
  } else if (page.val === at) return;
  showPage(at);
}

// Opening the palette is a push; when it is already open, it closes.
export function openPalette(at: string = 'root'): void {
  if (paletteEl().open) paletteEl().close();
  else go({ palette: at });
}

// The group button and its keybinding: the palette straight on its grouping
// page, closed again when it is already there.
export function openGroupPalette(): void {
  if (paletteEl().open) {
    if (page.val === 'tabGrouping') paletteEl().close();
    else go({ palette: 'tabGrouping' }, 'replace');
    return;
  }
  openPalette('tabGrouping');
}

export function initPalette(): void {
  // The menu is the shown page's groups; closed, it keeps the last page.
  keyed(
    paletteMenu(),
    () => menu.val,
    (g) => g.key,
    PaletteGroup,
  );
  // Registered after keyed's own derive on the same state, so it runs once
  // the render is on the page.
  van.derive(() => {
    if (menu.val.length) afterRender(menu.val);
  });
  paletteMenu().addEventListener('scroll', updatePaletteFades, { passive: true });
  // Filtering hides items after this handler's turn; measure once it has.
  paletteInput().addEventListener('input', () => requestAnimationFrame(updatePaletteFades));
  new ResizeObserver(updatePaletteFades).observe(paletteMenu());

  // Live preview: whatever setting is highlighted (keyboard or mouse) is shown,
  // or for typing sounds, heard once per highlight.
  let previewed: PaletteItem | undefined;
  new MutationObserver(() => {
    const item = itemsById.get(paletteMenu().querySelector('[role="menuitem"].active')?.id ?? '');
    if (paletteEl().open && item?.key) applySettings({ ...current.saved, [item.key]: item.value } as Settings);
    if (paletteEl().open && item?.key === 'typingSound' && item !== previewed) previewSound(String(item.value));
    if (paletteEl().open && item?.preview) item.preview();
    previewed = item;
  }).observe(paletteMenu(), { subtree: true, attributes: true, attributeFilter: ['class'] });

  // Runs before Basecoat's own click handler, which then closes the dialog
  // unless the item is marked data-keep-command-open.
  paletteMenu().addEventListener('click', (e) => {
    const el = (e.target as Element).closest('[role="menuitem"]');
    const item = el && el.getAttribute('aria-hidden') !== 'true' ? itemsById.get(el.id) : undefined;
    if (!item) return;
    if (item.go) {
      item.run?.();
      go({ palette: item.go }, 'replace');
    } else if (item.record) startRecording(item.record);
    else if (item.edit) startEditing(item.edit);
    else if (item.key) saveSetting(item.key, item.value as never);
    else item.run?.();
  });

  paletteInput().addEventListener('keydown', (e) => {
    if (editing) return;
    const toRoot = e.key === 'Escape' || (e.key === 'Backspace' && !paletteInput().value);
    if (toRoot && page.val !== 'root') {
      e.preventDefault(); // also stops Escape from closing the dialog
      go({ palette: 'root' }, 'replace');
    }
  });

  // Closing without picking reverts any preview. A close the place didn't
  // ask for (Esc, the backdrop, an item) takes the palette out of it: Back
  // over the entry that opened it, else a replace, so no step reopens it.
  paletteEl().addEventListener('close', () => {
    recording = null;
    editing = null;
    setPreviewing(false);
    applySettings(current.saved);
    store.active?.term.focus();
    if (!here().palette || isLeavingPalette()) return;
    if (isPaletteEntry()) back();
    else go({ palette: null }, 'replace');
  });

  // An unknown page opens the root page, and the URL says so.
  onPlace('palette', (to) => {
    const known = !to.palette || Object.hasOwn(palettePages(), to.palette);
    showPalette(known ? to.palette : 'root');
    return known ? undefined : { palette: 'root' };
  });

  // Clicking the backdrop closes it.
  paletteEl().addEventListener('click', (e) => {
    if (e.target === paletteEl()) paletteEl().close();
  });

  // Added first, so a key being recorded never reaches the listeners below.
  window.addEventListener('keydown', recordKey, true);
  window.addEventListener('keydown', editKey, true);
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
      if (paletteEl().open) return;
      const step = matchesKey(e, current.saved.keyNextTab) ? 1 : matchesKey(e, current.saved.keyPrevTab) ? -1 : 0;
      if (!step) return;
      e.preventDefault();
      e.stopPropagation(); // capture phase: keep it away from the terminal
      cycleTab(step);
    },
    true,
  );

  // The group keybinding opens the palette straight on its grouping page.
  window.addEventListener(
    'keydown',
    (e) => {
      if (paletteEl().open) return;
      if (!matchesKey(e, current.saved.keyGroupTabs)) return;
      e.preventDefault();
      e.stopPropagation(); // capture phase: keep it away from the terminal
      openGroupPalette();
    },
    true,
  );

  // The back and forward keybindings walk the history, unless a dialog
  // other than the palette has the page.
  window.addEventListener(
    'keydown',
    (e) => {
      const step = matchesKey(e, current.saved.keyBack)
        ? 'back'
        : matchesKey(e, current.saved.keyForward)
          ? 'forward'
          : '';
      if (!step || document.querySelector('dialog[open]:not(#palette)')) return;
      e.preventDefault();
      e.stopPropagation(); // capture phase: keep it away from the terminal
      if (step === 'back') back();
      else forward();
    },
    true,
  );

  const settingsBtn = document.getElementById('settings-btn') as HTMLButtonElement;
  // Set on hover so it always shows the current keybinding.
  settingsBtn.addEventListener('pointerenter', () => {
    settingsBtn.title = `Settings (${keyLabel(current.saved.keyPalette, isMac)})`;
  });
  settingsBtn.onclick = () => openPalette();

  // The group button beside it opens the palette on the grouping page.
  (document.getElementById('tab-group-btn') as HTMLButtonElement).onclick = openGroupPalette;
}
