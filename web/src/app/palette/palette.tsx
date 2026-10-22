// The command palette (Basecoat command-dialog): settings with live
// preview, recording a keybinding, editing a text (agent providers), the
// keybindings that open it and switch tabs, and the settings button.
// biome-ignore-all lint/a11y/useFocusableInteractive: Basecoat's rows: the input keeps focus and marks the active row
// biome-ignore-all lint/a11y/useSemanticElements: Basecoat's command markup, which its script and styles read
// biome-ignore-all lint/a11y/useAriaPropsForRole: Basecoat's group heading, named by the group's aria-labelledby
import { children, createEffect, createSignal, For, type JSX } from 'solid-js';
import van from 'vanjs-core';
import { toggleBoard, toggleBoardLayout } from '../board/view.tsx';
import { daemonFetch } from '../daemon/client.ts';
import { searchFiles, toggleExplorer } from '../explorer/explorer.ts';
import { loadedPane } from '../files/open.ts';
import { back, backPastPalette, forward, go, here, isLeavingPalette, isPaletteEntry, onPlace } from '../nav/router.ts';
import {
  addRemoteDevice,
  forgetRemote,
  loadRemote,
  onRemoteChange,
  remoteView,
  revokeRemoteDevice,
  toggleSharing,
} from '../remote/share.ts';
import { cycleTab, onScreen, store } from '../sessions/store.ts';
import { comboFromEvent, comboProblem, type KeyId, matchesKey } from '../settings/keys.ts';
import type { Settings } from '../settings/schema.ts';
import { applySettings, current, keyHint, saveSetting, setPreviewing } from '../settings/settings.ts';
import { previewChime } from '../sound/chime.ts';
import { previewSound } from '../sound/packs.ts';
import { aboutRows, loadAbout } from '../ui/about.ts';
import { isMac } from '../ui/dom.ts';
import { icons } from '../ui/icons.tsx';
import { type Performance, performanceRows } from '../ui/performance.ts';
import { showWelcome } from '../welcome/view.ts';
import { type PaletteItem, pages, type TextEdit } from './pages.ts';

const paletteEl = () => document.getElementById('palette') as HTMLDialogElement;
const paletteCmd = () => document.getElementById('palette-command') as HTMLElement & { refresh?: () => void };
const paletteInput = () => document.getElementById('palette-input') as HTMLInputElement;
const paletteMenu = () => document.getElementById('palette-menu') as HTMLElement;
// The page shown, or null while closed. Only the palette step assigns it.
export const page = van.state<string | null>(null);
let recording: KeyId | null = null; // the keybinding the next key press sets
let editing: TextEdit | null = null; // the text the input holds instead of a search
const rowItems = new WeakMap<Element, PaletteItem>();
let performanceView: [string, string][] | null = null;

async function loadPerformance(): Promise<void> {
  const info: Performance | null = await daemonFetch('/api/performance')
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  performanceView = info ? performanceRows(info) : [];
}

function palettePages(): ReturnType<typeof pages> {
  const active = store.active;
  return pages({
    hasFile: !!active && !!loadedPane()?.hasFile(active.id),
    closeFile: () => go({ file: null }),
    about: aboutRows,
    performance: performanceView,
    toggleExplorer,
    toggleBoard: () => toggleBoard(),
    toggleBoardLayout,
    showWelcome,
    remote: remoteView(),
    toggleSharing: () => void toggleSharing(),
    addDevice: (name) => void addRemoteDevice(name),
    revokeDevice: (id) => void revokeRemoteDevice(id),
    searchFiles,
    canGoBack: navigation.canGoBack,
    goBack: backPastPalette,
  });
}

// A shown page's groups, each item with its menu id. Every render is new
// objects, so a page shown again is built afresh, its checks and hints current.
interface MenuGroup {
  heading: string;
  id: string;
  items: { id: string; item: PaletteItem }[];
}
const [menu, setMenu] = createSignal<MenuGroup[]>([]);

function showPage(name: string): void {
  page.val = name;
  recording = null;
  editing = null;
  paletteMenu().hidden = false;
  const { placeholder, groups } = palettePages()[name]();
  paletteInput().value = '';
  paletteInput().placeholder = name === 'root' ? placeholder : `${placeholder}  (Esc to go back)`;
  let k = 0;
  setMenu(
    groups.map((g, gi) => ({
      heading: g.heading,
      id: `pg-${gi}`,
      items: g.items.map((item) => ({ id: `pi-${k++}`, item })),
    })),
  );
  if (name === 'root') applySettings(current.saved);
  paletteInput().focus();
}

const SWATCH = ['red', 'green', 'yellow', 'blue', 'magenta'] as const;

// A row's click runs before Basecoat's on the menu, which then closes the
// dialog unless the row is marked data-keep-command-open.
function pick(row: Element, item: PaletteItem): void {
  if (row.getAttribute('aria-hidden') === 'true') return;
  if (item.go) {
    item.run?.();
    go({ palette: item.go }, 'replace');
  } else if (item.record) startRecording(item.record);
  else if (item.edit) startEditing(item.edit);
  else if (item.copy !== undefined)
    navigator.clipboard.writeText(item.copy).then(
      () => (paletteInput().placeholder = `Copied ${item.label}  (Esc to go back)`),
      () => {},
    );
  else if (item.key) saveSetting(item.key, item.value as never);
  else item.run?.();
}

function PaletteRow(props: { id: string; item: PaletteItem }): JSX.Element {
  const { id, item } = props;
  if (item.figure) {
    return (
      <div role="menuitem" id={id} class="palette-figure" aria-disabled="true" data-filter={item.label}>
        {item.figure}
      </div>
    );
  }
  const keep = !!(item.go || item.record || item.edit || item.copy !== undefined || item.disabled);
  const checked = !!((item.key && current.saved[item.key] === item.value) || item.checked);
  const { swatch } = item;
  const row = (
    <div
      role="menuitem"
      id={id}
      data-filter={item.label}
      data-keywords={item.keywords ?? ''}
      aria-disabled={item.disabled ? 'true' : undefined}
      data-keep-command-open={keep ? '' : undefined}
      data-checked={checked ? 'true' : undefined}
      on:click={(e) => pick(e.currentTarget, item)}
    >
      {item.icon?.() ??
        (swatch && (
          <span class="swatch" style={{ background: swatch.background }}>
            {SWATCH.map((c) => (
              <i style={{ background: swatch[c] }} />
            ))}
          </span>
        ))}
      <span class="palette-label">{item.label}</span>
      {item.hint && <span data-shortcut="">{item.hint}</span>}
      {(item.key || item.checked) && <span data-indicator="">{icons.check()}</span>}
    </div>
  ) as HTMLElement;
  rowItems.set(row, item);
  return row;
}

function PaletteGroup(props: { group: MenuGroup }): JSX.Element {
  const g = props.group;
  return (
    <div role="group" aria-labelledby={g.id}>
      <span role="heading" id={g.id}>
        {g.heading}
      </span>
      <For each={g.items}>{(row) => <PaletteRow id={row.id} item={row.item} />}</For>
    </div>
  );
}

// The shown page's rows, inside #palette-menu; closed, it keeps the last page.
export function PaletteRows(): JSX.Element {
  const rows = children(() => <For each={menu()}>{(g) => <PaletteGroup group={g} />}</For>);
  // Reads the rendered rows, so it runs once per page, after the insert has
  // put them on the page (render effects run before user effects).
  createEffect(() => {
    if (rows.toArray().length) afterRender();
  });
  return <>{rows()}</>;
}

// Once a page's rows are on the page: Basecoat's command menu caches its
// items, so it takes the new ones; then the page starts on the current choice
// rather than the first entry.
function afterRender(): void {
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
  const wasRemote = isRemotePage(page.val);
  if (!isRemotePage(at)) forgetRemote();
  if (!at) {
    page.val = null;
    if (paletteEl().open) paletteEl().close();
    return;
  }
  if (!paletteEl().open) {
    paletteEl().showModal();
    setPreviewing(true);
  } else if (page.val === at) return;
  // About and Performance are fetched afresh each time they open, and drawn once they land.
  if (at === 'about')
    loadAbout().then(() => {
      if (page.val === 'about') showPage('about');
    });
  if (at === 'performance')
    loadPerformance().then(() => {
      if (page.val === 'performance') showPage('performance');
    });
  // Read afresh on the way in; redrawn by `onRemoteChange` once it lands.
  if (isRemotePage(at) && !wasRemote) void loadRemote();
  showPage(at);
}

const isRemotePage = (name: string | null) => name === 'remote' || !!name?.startsWith('remote:');

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
  paletteMenu().addEventListener('scroll', updatePaletteFades, { passive: true });
  // Filtering hides items after this handler's turn; measure once it has.
  paletteInput().addEventListener('input', () => requestAnimationFrame(updatePaletteFades));
  new ResizeObserver(updatePaletteFades).observe(paletteMenu());

  // Live preview: whatever setting is highlighted (keyboard or mouse) is shown,
  // or for typing sounds and card chimes, heard once per highlight.
  let previewed: PaletteItem | undefined;
  new MutationObserver(() => {
    const row = paletteMenu().querySelector('[role="menuitem"].active');
    const item = row ? rowItems.get(row) : undefined;
    if (paletteEl().open && item?.key) applySettings({ ...current.saved, [item.key]: item.value } as Settings);
    if (paletteEl().open && item?.key === 'typingSound' && item !== previewed) previewSound(String(item.value));
    if (paletteEl().open && (item?.key === 'needsInputSound' || item?.key === 'completedSound') && item !== previewed)
      previewChime(String(item.value));
    if (paletteEl().open && item?.preview) item.preview();
    previewed = item;
  }).observe(paletteMenu(), { subtree: true, attributes: true, attributeFilter: ['class'] });

  paletteInput().addEventListener('keydown', (e) => {
    if (editing) return;
    // Esc, or Backspace in an empty field, returns to the page that opened
    // this one (a provider's page to the providers list). On the root page
    // Esc still closes the dialog.
    const back = e.key === 'Escape' || (e.key === 'Backspace' && !paletteInput().value);
    const at = page.val;
    if (back && at && at !== 'root') {
      e.preventDefault(); // also stops Escape from closing the dialog
      const up = at.startsWith('provider:') ? 'providers' : at.startsWith('remote:') ? 'remote' : 'root';
      go({ palette: up }, 'replace');
    }
  });

  // Closing without picking reverts any preview. A close the place didn't
  // ask for (Esc, the backdrop, an item) takes the palette out of it: Back
  // over the entry that opened it, else a replace, so no step reopens it.
  // A sharing change that lands redraws the page showing it, unless a name is
  // being typed there.
  onRemoteChange(() => {
    if (paletteEl().open && isRemotePage(page.val) && !editing) showPage(page.val as string);
  });

  paletteEl().addEventListener('close', () => {
    forgetRemote();
    recording = null;
    editing = null;
    setPreviewing(false);
    applySettings(current.saved);
    onScreen()?.term.focus();
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
  keyHint(settingsBtn, 'Settings', 'keyPalette');
  settingsBtn.onclick = () => openPalette();

  // The group button beside it opens the palette on the grouping page.
  const groupBtn = document.getElementById('tab-group-btn') as HTMLButtonElement;
  keyHint(groupBtn, 'Group tabs', 'keyGroupTabs');
  groupBtn.onclick = openGroupPalette;
}
