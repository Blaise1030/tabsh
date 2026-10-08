// New card, laid out like Linear's New issue. Clicking the backdrop closes
// it. The folder (searched as it's
// typed, recent ones offered first; see folder-picker.ts) and the agent
// provider (set up in the palette; the last one used first) as chips at the
// top, the first prompt as the body, then the column it goes in and optional
// tags (the provider and column chips are Basecoat dropdowns),
// ticked in the same panel as a card's Tags submenu (tags-submenu.ts; the
// group it opens in gives its tag, which can be taken off). Images dropped
// anywhere on the dialog, pasted into the prompt or picked with the
// paperclip are uploaded on Create and their paths follow the prompt. The
// board stays open and the card goes on top of its column. In Backlog it waits, and its agent starts when it's dragged to In progress; in
// In progress, its agent starts at once. With Create more on, the dialog
// stays open for the next card. The card is titled by its prompt until its
// terminal gives it a title.
import van, { type State } from 'vanjs-core';
import { ApiError, uploadFile } from '../daemon/client.ts';
import { newTabGroup } from '../sessions/groups.ts';
import { addTag } from '../sessions/labels.ts';
import { openTab, type Session, store } from '../sessions/store.ts';
import { setTags, tagBadge } from '../sessions/tags.ts';
import { current, saveSetting } from '../settings/settings.ts';
import { isMac } from '../ui/dom.ts';
import { glyph, icons } from '../ui/icons.ts';
import { keyed } from '../ui/keyed.ts';
import { type FolderPicker, initFolderPicker } from './folder-picker.ts';
import { STATUS_NAMES } from './glyph.ts';
import { recentFolders, type Status, withImages } from './model.ts';
import { TagsPanel } from './tags-submenu.ts';
import { moveToTop, setNewCard } from './view.ts';

const { button, dialog, div, footer, form, h2, header, img, input, label, p, section, span, textarea, ul } = van.tags;

// The columns a new card can go in.
type Start = 'backlog' | 'in_progress';
// An image waiting to be uploaded on Create, shown by its blob: URL.
type Image = { file: File; url: string };

let host: HTMLDialogElement;
let formEl: HTMLFormElement;
let promptEl: HTMLTextAreaElement;
let folder: FolderPicker;
let tagsPanel: TagsPanel;

// The providers offered (by name) and the one picked, and what the last try
// said (null: nothing).
const providers: State<string[]> = van.state([]);
const provider = van.state('');
const error: State<string | null> = van.state(null);
const start: State<Start> = van.state('backlog');
const images: State<Image[]> = van.state([]);
const big = van.state(false); // the expanded dialog
const dragging = van.state(false); // files over the dialog
const busy = van.state(false); // creating: uploads and the card
// What the Folder and Tags chips show.
const folderText = van.state('');
const pickedTags: State<string[]> = van.state([]);

// The home folder as seen in other cards' paths, until the folder search
// hears the daemon's.
const cardsHome = () =>
  store.sessions.map((s) => s.card.val.cwd?.match(/^\/(Users|home)\/[^/]+/)?.[0]).find(Boolean) ?? null;

const isImage = (f: File) => f.type.startsWith('image/');
const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files');

function addImages(files: Iterable<File>): void {
  const added = [...files].filter(isImage).map((file) => ({ file, url: URL.createObjectURL(file) }));
  if (added.length) images.val = [...images.val, ...added];
}

function removeImage(gone: Image): void {
  URL.revokeObjectURL(gone.url);
  images.val = images.val.filter((x) => x !== gone);
}

function clearImages(): void {
  for (const x of images.val) URL.revokeObjectURL(x.url);
  images.val = [];
}

export function openNewCard(status: Status): void {
  start.val = status === 'backlog' ? 'backlog' : 'in_progress';
  formEl.reset();
  error.val = null;
  busy.val = false;
  clearImages();
  const recent = recentFolders(store.sessions.map((s) => ({ card: s.card.val })));
  folder.reset(recent, cardsHome());
  (formEl.elements.namedItem('cwd') as HTMLInputElement).value = recent[0] ?? '';
  folderText.val = recent[0] ?? '';
  const names = current.saved.providers.map((p) => p.name);
  providers.val = names;
  const last = current.saved.agentProvider;
  provider.val = names.includes(last) ? last : (names[0] ?? '');
  const { tag } = newTabGroup();
  pickedTags.val = tag ? [tag] : [];
  tagsPanel.field.value = '';
  host.showModal();
  promptEl.focus();
}

async function submit(e: Event): Promise<void> {
  e.preventDefault();
  if (busy.val) return;
  const data = new FormData(formEl);
  const cwd = folder.value();
  const saved = current.saved.providers;
  const chosen = saved.find((p) => p.name === provider.val) ?? saved[0];
  const { command, resume } = chosen;
  const picked = addTag(pickedTags.val, tagsPanel.field.value); // a new tag typed but not entered still counts
  const more = data.get('more') === 'on';
  busy.val = true;
  error.val = null;
  let s: Session;
  try {
    let paths: string[];
    try {
      paths = await Promise.all(images.val.map((x) => uploadFile(x.file)));
    } catch {
      error.val = "Couldn't attach the images";
      return;
    }
    const prompt = withImages(String(data.get('prompt') ?? '').trim(), paths);
    try {
      s = await openTab({ ...(cwd && { cwd }), prompt, command, resume }, false);
    } catch (err) {
      // The daemon answers 400 for a folder that isn't there.
      const badFolder = err instanceof ApiError && err.status === 400 && cwd;
      error.val = badFolder ? `No folder at ${cwd}` : "Couldn't create the card";
      return;
    }
  } finally {
    busy.val = false;
  }
  // Exactly the chips: the group's tag, given on opening, goes if taken off.
  setTags(s, picked);
  // The next card offers it first.
  saveSetting('agentProvider', chosen.name);
  if (more) {
    // Same folder, agent, column and tags; a fresh prompt.
    promptEl.value = '';
    clearImages();
    promptEl.focus();
  } else host.close();
  await moveToTop(s, start.val); // sets its status too
}

// A combobox chip, as in Linear: a button showing the value, opening a
// popover (the folder's search box and list, or the tags panel); `opened`
// focuses into it. Esc, or focus leaving
// it, closes the popover (not the dialog); the button gets the focus back.
function popChip(
  name: string,
  shown: () => Node | string,
  opened: () => void,
  ...body: HTMLElement[]
): { node: HTMLElement; close: () => void } {
  const open = van.state(false);
  const trigger = button(
    {
      type: 'button',
      class: 'nc-chip nc-trigger',
      'aria-label': name,
      'aria-haspopup': 'listbox',
      'aria-expanded': () => String(open.val),
      onclick: () => {
        open.val = !open.val;
        if (!open.val) return;
        // Once VanJS has shown the popover (in a microtask queued before this).
        queueMicrotask(opened);
      },
    },
    shown,
  );
  const close = (refocus = false) => {
    open.val = false;
    if (refocus) trigger.focus();
  };
  const pop = div(
    {
      class: 'nc-pop',
      hidden: () => !open.val,
    },
    ...body,
  );
  const node: HTMLElement = span(
    {
      class: 'nc-pick',
      // Focus that left for nowhere is checked once it settles: a tag's ×
      // pressed from the keyboard is replaced (focus drops to the page) and
      // hands focus back to the box.
      onfocusout: (e: FocusEvent) => {
        if (node.contains(e.relatedTarget as Node | null)) return;
        setTimeout(() => {
          if (!node.contains(document.activeElement)) close();
        });
      },
    },
    trigger,
    pop,
  );
  // Caught before the picker's own keys: Esc closes the popover, not just
  // its list, and Enter with no list showing closes it too, rather than
  // creating the card.
  node.addEventListener(
    'keydown',
    (e) => {
      if (!open.val) return;
      const listShut = (pop.querySelector('[role="listbox"]') as HTMLElement | null)?.hidden;
      if (e.key === 'Escape' || (e.key === 'Enter' && !e.isComposing && listShut)) {
        e.preventDefault();
        e.stopPropagation();
        close(true);
      }
    },
    true,
  );
  return { node, close: () => close(true) };
}

const thumb = (x: Image) =>
  span(
    { class: 'nc-thumb' },
    img({ src: x.url, alt: x.file.name, title: x.file.name }),
    button(
      { type: 'button', class: 'nc-thumb-off', 'aria-label': `Remove ${x.file.name}`, onclick: () => removeImage(x) },
      icons.close(),
    ),
  );

// A chip as Basecoat's dropdown menu (its script opens and closes it, and
// moves through it by keyboard), like a card's Move menu: `items` are its
// rows, the one in `value` checked; `face` draws a value (icon and name).
function ChipMenu<T extends string>(
  name: string,
  items: () => T[],
  value: State<T>,
  face: (v: T) => (Node | string)[],
): HTMLElement {
  const row = (v: T) =>
    div(
      {
        role: 'menuitemradio',
        'aria-checked': () => String(value.val === v),
        onclick: () => {
          value.val = v;
        },
      },
      ...face(v),
      () => (value.val === v ? icons.check() : span()),
    );
  const menu = div({ role: 'menu', 'aria-label': name });
  keyed(menu, items, (v) => v, row);
  return div(
    {
      class: 'dropdown-menu nc-menu',
      // Esc closes the menu (Basecoat's key, on this same element), not the
      // dialog behind it.
      onkeydown: (e: KeyboardEvent) => {
        if (e.key !== 'Escape' || !(e.currentTarget as Element).querySelector('[aria-expanded="true"]')) return;
        e.preventDefault();
        e.stopPropagation();
      },
    },
    button(
      {
        type: 'button',
        class: 'nc-chip nc-trigger',
        'aria-label': name,
        'aria-haspopup': 'menu',
        'aria-expanded': 'false',
      },
      () => span({ class: 'nc-trigger-body' }, ...face(value.val), icons.chevronDown()),
    ),
    div({ 'data-popover': '', 'aria-hidden': 'true' }, menu),
  );
}

const named = (icon: () => SVGSVGElement, text: string) => [icon(), span({ class: 'nc-value' }, text)];

// The New card dialog lives as long as the page.
export function NewCard(): HTMLDialogElement {
  const cwd = input({
    class: 'nc-search',
    name: 'cwd',
    placeholder: 'Search folders or type a path…',
    'aria-label': 'Folder',
    autocomplete: 'off',
    spellcheck: false,
    oninput: () => {
      folderText.val = cwd.value;
    },
  });
  const folderList = ul({
    id: 'new-card-folders',
    class: 'picker-options nc-options',
    role: 'listbox',
    'aria-label': 'Folders',
    hidden: true,
  });

  tagsPanel = TagsPanel(
    () => pickedTags.val,
    (next) => {
      pickedTags.val = next;
    },
    () => tagsChip.close(),
  );
  const files = input({
    type: 'file',
    accept: 'image/*',
    multiple: true,
    hidden: true,
    onchange: () => {
      addImages(files.files ?? []);
      files.value = '';
    },
  });
  promptEl = textarea({
    class: 'nc-prompt',
    name: 'prompt',
    rows: 3,
    required: true,
    'aria-label': 'First prompt',
    placeholder: 'What should the agent do?',
    onpaste: (e: ClipboardEvent) => {
      const pasted = [...(e.clipboardData?.files ?? [])].filter(isImage);
      if (!pasted.length) return;
      e.preventDefault(); // the image, not its file name as text
      addImages(pasted);
    },
    onkeydown: (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (isMac ? e.metaKey : e.ctrlKey)) {
        e.preventDefault();
        formEl.requestSubmit();
      }
    },
  });
  const thumbs = div({ class: 'nc-thumbs', hidden: () => images.val.length === 0 });
  const folderChip = popChip(
    'Folder',
    () =>
      span(
        { class: 'nc-trigger-body' },
        icons.folder(),
        span({ class: 'nc-value', title: folderText.val }, folderText.val || 'Folder'),
      ),
    () => {
      cwd.focus();
      folder.open();
    },
    cwd,
    folderList,
  );
  const tagsChip = popChip(
    'Tags',
    () =>
      span(
        { class: 'nc-trigger-body' },
        icons.tag(),
        ...(pickedTags.val.length ? pickedTags.val.map((t) => tagBadge(t)) : [span({ class: 'nc-value' }, 'Tags')]),
      ),
    () => {
      tagsPanel.close(); // so it lists the tags in use now
      tagsPanel.open(true);
    },
    tagsPanel.panel,
  );
  formEl = form(
    { method: 'dialog', id: 'new-card-form', onsubmit: submit },
    header(
      { class: 'nc-head' },
      h2({ id: 'new-card-title', class: 'sr-only' }, 'New card'),
      div(
        { class: 'nc-crumbs' },
        folderChip.node,
        span({ class: 'nc-sep', 'aria-hidden': 'true' }, icons.chevronRight()),
        ChipMenu(
          'Agent',
          () => providers.val,
          provider,
          (v) => named(icons.agent, v || 'Agent'),
        ),
      ),
      div(
        { class: 'nc-tools' },
        button(
          {
            type: 'button',
            class: 'btn',
            'data-variant': 'ghost',
            'data-size': 'icon-sm',
            'aria-label': () => (big.val ? 'Collapse' : 'Expand'),
            'aria-pressed': () => String(big.val),
            onclick: () => {
              big.val = !big.val;
            },
          },
          () => (big.val ? icons.shrink() : icons.expand()),
        ),
        button(
          {
            type: 'button',
            class: 'btn',
            'data-variant': 'ghost',
            'data-size': 'icon-sm',
            value: 'cancel',
            'aria-label': 'Close',
            onclick: () => host.close(),
          },
          icons.close(),
        ),
      ),
    ),
    section({ class: 'nc-body' }, promptEl, thumbs),
    div(
      { class: 'nc-props' },
      ChipMenu<Start>(
        'Column',
        () => ['backlog', 'in_progress'],
        start,
        (v) => named(() => glyph(v), STATUS_NAMES[v]),
      ),
      tagsChip.node,
    ),
    p({ class: 'new-card-error', role: 'alert', hidden: () => error.val === null }, () => error.val ?? ''),
    footer(
      { class: 'nc-foot' },
      button(
        {
          type: 'button',
          class: 'btn nc-attach',
          'data-variant': 'outline',
          'data-size': 'icon',
          'aria-label': 'Attach images',
          title: 'Attach images (or drop them here)',
          onclick: () => files.click(),
        },
        icons.paperclip(),
      ),
      files,
      label(
        { class: 'nc-more' },
        input({ type: 'checkbox', role: 'switch', class: 'input', name: 'more' }),
        'Create more',
      ),
      button({ type: 'submit', class: 'btn', disabled: () => busy.val }, () =>
        busy.val ? 'Creating…' : 'Create card',
      ),
    ),
    div({ class: 'nc-drop', 'aria-hidden': 'true' }, icons.paperclip(), span('Drop images to attach')),
  );
  host = dialog(
    {
      id: 'new-card',
      class: () => `dialog new-card${big.val ? ' big' : ''}${dragging.val ? ' dragging' : ''}`,
      'aria-labelledby': 'new-card-title',
      // The dialog is the overlay; a click on it, not on the form, is the backdrop.
      onclick: (e: MouseEvent) => {
        if (e.target === e.currentTarget) (e.currentTarget as HTMLDialogElement).close();
      },
      onclose: () => {
        dragging.val = false;
        clearImages();
      },
      // Files dropped anywhere on the dialog (or its backdrop) are its own:
      // they never reach the terminal behind it (ui/drop.ts).
      ondragenter: (e: DragEvent) => {
        if (!hasFiles(e)) return;
        e.stopPropagation();
        dragging.val = true;
      },
      ondragover: (e: DragEvent) => {
        if (!hasFiles(e)) return;
        e.stopPropagation();
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
        dragging.val = true;
      },
      ondragleave: (e: DragEvent) => {
        e.stopPropagation();
        if (!host.contains(e.relatedTarget as Node | null)) dragging.val = false;
      },
      ondrop: (e: DragEvent) => {
        if (!hasFiles(e)) return;
        e.stopPropagation();
        e.preventDefault();
        dragging.val = false;
        addImages(e.dataTransfer?.files ?? []);
      },
    },
    formEl,
  );
  keyed(
    thumbs,
    () => images.val,
    (x) => x.url,
    thumb,
  );
  folder = initFolderPicker(cwd, folderList, () => {
    folderText.val = cwd.value;
    folderChip.close();
  });
  setNewCard(openNewCard);
  return host;
}
