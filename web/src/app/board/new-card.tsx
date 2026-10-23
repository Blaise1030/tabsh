// New card, laid out like Linear's New issue. Clicking the backdrop closes
// it. The folder (searched as it's
// typed, recent ones offered first; see folder-picker.ts) and the agent
// provider (set up in the palette; the last one used first) as chips at the
// top, the first prompt as the body, then the column it goes in and optional
// tags (the provider and column chips are Basecoat dropdowns),
// ticked in the same panel as a card's Tags submenu (tags-submenu.tsx; the
// group it opens in gives its tag, which can be taken off). Images dropped
// anywhere on the dialog, pasted into the prompt or picked with the
// paperclip are uploaded on Create and their paths follow the prompt. The
// board stays open and the card goes on top of its column. In Backlog it waits, and its agent starts when it's dragged to In progress; in
// In progress, its agent starts at once. With Create more on, the dialog
// stays open for the next card. The card is titled by its prompt until its
// terminal gives it a title. A Backlog card still waiting on its prompt
// opens here too, to edit (its card menu's Edit): its prompt, agent and tags,
// in the folder and column it has.
// Its handlers are native: Basecoat's dropdowns and the chips' popovers
// listen on their own elements and stop what they take, before Solid's
// delegated handlers on the document would run.
// biome-ignore-all lint/a11y/noNoninteractiveElementToInteractiveRole: the folder field's listbox, filled by folder-picker.ts
import { type Accessor, createSignal, For, type JSX } from 'solid-js';
import { ApiError, api, uploadFile } from '../daemon/client.ts';
import { newTabGroup } from '../sessions/groups.tsx';
import { addTag } from '../sessions/labels.ts';
import { openTab, type Session, type SessionInfo, store } from '../sessions/store.ts';
import { setName } from '../sessions/tabs.ts';
import { setTags, tagBadge } from '../sessions/tags.tsx';
import type { AgentMode } from '../settings/schema.ts';
import { current, saveSetting } from '../settings/settings.ts';
import { isMac } from '../ui/dom.ts';
import { glyph, icons, providerIcon } from '../ui/icons.tsx';
import { type FolderPicker, initFolderPicker } from './folder-picker.ts';
import { STATUS_NAMES } from './glyph.ts';
import { recentFolders, type Status, withImages } from './model.ts';
import { setEditCard } from './move-menu.tsx';
import { canUseUi, openTabCreateBody } from './new-card-mode.ts';
import { applyCard, cardOf } from './status.ts';
import { TagsPanel } from './tags-submenu.tsx';
import { moveToTop, setNewCard } from './view.tsx';

// The columns a new card can go in.
type Start = 'backlog' | 'in_progress';
// An image waiting to be uploaded on Create, shown by its blob: URL.
type Image = { file: File; url: string };

let host: HTMLDialogElement;
let pressedBackdrop = false;
let formEl: HTMLFormElement;
let promptEl: HTMLTextAreaElement;
let folder: FolderPicker;
let tagsPanel: TagsPanel;

// The providers offered (by name) and the one picked, and what the last try
// said (null: nothing).
const [providers, setProviders] = createSignal<string[]>([]);
const [provider, setProvider] = createSignal('');
const [agentMode, setAgentMode] = createSignal<AgentMode>('tui');
const [error, setError] = createSignal<string | null>(null);
const [start, setStart] = createSignal<Start>('backlog');
const [images, setImages] = createSignal<Image[]>([]);
const [big, setBig] = createSignal(false); // the expanded dialog
const [dragging, setDragging] = createSignal(false); // files over the dialog
const [busy, setBusy] = createSignal(false); // creating: uploads and the card
// What the Folder and Tags chips show.
const [folderText, setFolderText] = createSignal('');
const [pickedTags, setPickedTags] = createSignal<string[]>([]);
// The card being edited (null: a new one), and the agent it had.
const [editing, setEditing] = createSignal<Session | null>(null);
let editedProvider = '';

// The home folder as seen in other cards' paths, until the folder search
// hears the daemon's.
const cardsHome = () =>
  store.sessions.map((s) => s.card().cwd?.match(/^\/(Users|home)\/[^/]+/)?.[0]).find(Boolean) ?? null;

const isImage = (f: File) => f.type.startsWith('image/');
const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files');

function addImages(files: Iterable<File>): void {
  const added = [...files].filter(isImage).map((file) => ({ file, url: URL.createObjectURL(file) }));
  if (added.length) setImages([...images(), ...added]);
}

function removeImage(gone: Image): void {
  URL.revokeObjectURL(gone.url);
  setImages(images().filter((x) => x !== gone));
}

function clearImages(): void {
  for (const x of images()) URL.revokeObjectURL(x.url);
  setImages([]);
}

export function openNewCard(status: Status): void {
  setEditing(null);
  setStart(status === 'backlog' ? 'backlog' : 'in_progress');
  formEl.reset();
  setError(null);
  setBusy(false);
  clearImages();
  const recent = recentFolders(store.sessions.map((s) => ({ card: s.card() })));
  folder.reset(recent, cardsHome());
  (formEl.elements.namedItem('cwd') as HTMLInputElement).value = recent[0] ?? '';
  setFolderText(recent[0] ?? '');
  const names = current.saved.providers.map((p) => p.name);
  setProviders(names);
  const last = current.saved.agentProvider;
  const picked = names.includes(last) ? last : (names[0] ?? '');
  setProvider(picked);
  const prov = current.saved.providers.find((p) => p.name === picked);
  const mode = current.saved.agentMode;
  setAgentMode(mode === 'ui' && canUseUi(prov) ? 'ui' : 'tui');
  const { tag } = newTabGroup();
  setPickedTags(tag ? [tag] : []);
  tagsPanel.field.value = '';
  host.showModal();
  promptEl.focus();
}

// A Backlog card that hasn't started: its prompt, agent and tags.
export function openEditCard(s: Session): void {
  setEditing(s);
  formEl.reset();
  setError(null);
  setBusy(false);
  clearImages();
  setFolderText(s.card().cwd ?? '~');
  setProviders(current.saved.providers.map((p) => p.name));
  // Its agent, when it's still one of the providers.
  editedProvider = current.saved.providers.find((p) => p.command === s.card().command)?.name ?? '';
  setProvider(editedProvider);
  setPickedTags([...s.tags()]);
  tagsPanel.field.value = '';
  promptEl.value = s.card().prompt ?? '';
  host.showModal();
  promptEl.focus();
}

async function save(s: Session): Promise<void> {
  const picked = addTag(pickedTags(), tagsPanel.field.value);
  const chosen = provider() === editedProvider ? null : current.saved.providers.find((p) => p.name === provider());
  setBusy(true);
  setError(null);
  let info: SessionInfo | null;
  try {
    let paths: string[];
    try {
      paths = await Promise.all(images().map((x) => uploadFile(x.file)));
    } catch {
      setError("Couldn't attach the images");
      return;
    }
    const prompt = withImages(promptEl.value.trim(), paths);
    try {
      // Without a command, the card keeps its agent.
      info = await api<SessionInfo>('PATCH', `/${s.id}/prompt`, {
        prompt,
        ...(chosen && { command: chosen.command, resume: chosen.resume }),
      });
    } catch (err) {
      // 409: it left Backlog, so its agent already has the prompt.
      const started = err instanceof ApiError && err.status === 409;
      setError(started ? 'This card has already started' : "Couldn't save the card");
      return;
    }
  } finally {
    setBusy(false);
  }
  if (info) {
    setName(s, info.name, false);
    applyCard(s, cardOf(info));
  }
  setTags(s, picked);
  if (chosen) saveSetting('agentProvider', chosen.name);
  host.close();
}

async function submit(e: Event): Promise<void> {
  e.preventDefault();
  if (busy()) return;
  const edited = editing();
  if (edited) return save(edited);
  const data = new FormData(formEl);
  const cwd = folder.value();
  const saved = current.saved.providers;
  const chosen = saved.find((p) => p.name === provider()) ?? saved[0];
  const { command, resume } = chosen;
  const picked = addTag(pickedTags(), tagsPanel.field.value); // a new tag typed but not entered still counts
  const more = data.get('more') === 'on';
  setBusy(true);
  setError(null);
  let s: Session;
  try {
    let paths: string[];
    try {
      paths = await Promise.all(images().map((x) => uploadFile(x.file)));
    } catch {
      setError("Couldn't attach the images");
      return;
    }
    const prompt = withImages(String(data.get('prompt') ?? '').trim(), paths);
    try {
      const body = openTabCreateBody(
        { ...(cwd && { cwd }), prompt, command, resume: resume ?? '' },
        chosen,
        agentMode(),
      );
      s = await openTab(body, false);
    } catch (err) {
      // The daemon answers 400 for a folder that isn't there.
      const badFolder = err instanceof ApiError && err.status === 400 && cwd;
      setError(badFolder ? `No folder at ${cwd}` : "Couldn't create the card");
      return;
    }
  } finally {
    setBusy(false);
  }
  // Exactly the chips: the group's tag, given on opening, goes if taken off.
  setTags(s, picked);
  // The next card offers it first.
  saveSetting('agentProvider', chosen.name);
  saveSetting('agentMode', agentMode());
  if (more) {
    // Same folder, agent, column and tags; a fresh prompt.
    promptEl.value = '';
    clearImages();
    promptEl.focus();
  } else host.close();
  await moveToTop(s, start()); // sets its status too
}

// A combobox chip, as in Linear: a button showing the value, opening a
// popover (the folder's search box and list, or the tags panel); `opened`
// focuses into it. Esc, or focus leaving
// it, closes the popover (not the dialog); the button gets the focus back.
function popChip(
  name: string,
  shown: () => JSX.Element,
  opened: () => void,
  ...body: HTMLElement[]
): { node: HTMLElement; close: () => void } {
  const [open, setOpen] = createSignal(false);
  const trigger = (
    <button
      type="button"
      class="nc-chip nc-trigger"
      aria-label={name}
      aria-haspopup="listbox"
      aria-expanded={open()}
      on:click={() => {
        setOpen(!open());
        // The popover shows as the signal is set.
        if (open()) opened();
      }}
    >
      {shown()}
    </button>
  ) as HTMLButtonElement;
  const close = (refocus = false) => {
    setOpen(false);
    if (refocus) trigger.focus();
  };
  const pop = (
    <div class="nc-pop" hidden={!open()}>
      {body}
    </div>
  ) as HTMLElement;
  const node = (
    <span
      class="nc-pick"
      // Focus that left for nowhere is checked once it settles: a tag's ×
      // pressed from the keyboard is replaced (focus drops to the page) and
      // hands focus back to the box.
      on:focusout={(e) => {
        if (node.contains(e.relatedTarget as Node | null)) return;
        setTimeout(() => {
          if (!node.contains(document.activeElement)) close();
        });
      }}
    >
      {trigger}
      {pop}
    </span>
  ) as HTMLElement;
  // Caught before the picker's own keys: Esc closes the popover, not just
  // its list, and Enter with no list showing closes it too, rather than
  // creating the card.
  node.addEventListener(
    'keydown',
    (e) => {
      if (!open()) return;
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

function Thumb(props: { image: Image }): JSX.Element {
  const x = props.image;
  return (
    <span class="nc-thumb">
      <img src={x.url} alt={x.file.name} title={x.file.name} />
      <button type="button" class="nc-thumb-off" aria-label={`Remove ${x.file.name}`} on:click={() => removeImage(x)}>
        {icons.close()}
      </button>
    </span>
  );
}

// A chip as Basecoat's dropdown menu (its script opens and closes it, and
// moves through it by keyboard), like a card's Move menu: `items` are its
// rows, the one in `value` checked; `face` draws a value (icon and name).
function ChipMenu<T extends string>(props: {
  name: string;
  items: T[];
  value: Accessor<T>;
  set: (v: T) => void;
  face: (v: T) => JSX.Element;
}): JSX.Element {
  const { name, value, set, face } = props;
  return (
    <div
      class="dropdown-menu nc-menu"
      // Esc closes the menu (Basecoat's key, on this same element), not the
      // dialog behind it.
      on:keydown={(e) => {
        if (e.key !== 'Escape' || !(e.currentTarget as Element).querySelector('[aria-expanded="true"]')) return;
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <button type="button" class="nc-chip nc-trigger" aria-label={name} aria-haspopup="menu" aria-expanded="false">
        <span class="nc-trigger-body">
          {face(value())}
          {icons.chevronDown()}
        </span>
      </button>
      <div data-popover="" aria-hidden="true">
        <div role="menu" aria-label={name}>
          <For each={props.items}>
            {(v) => (
              // biome-ignore lint/a11y/useFocusableInteractive: Basecoat's rows: the menu keeps focus and marks the active row
              <div role="menuitemradio" aria-checked={value() === v} on:click={() => set(v)}>
                {face(v)}
                {value() === v ? icons.check() : <span />}
              </div>
            )}
          </For>
        </div>
      </div>
    </div>
  );
}

// Agent chip: provider plus TUI/UI in one menu. The face shows the mode so
// the separate mode crumb is not needed.
function AgentMenu(): JSX.Element {
  const prov = () => current.saved.providers.find((p) => p.name === provider());
  const face = () => (
    <>
      {providerIcon(prov()?.command ?? '')()}
      <span class="nc-value">{provider() || 'Agent'}</span>
      <span class="nc-mode-tag">{agentMode() === 'ui' ? 'UI' : 'TUI'}</span>
    </>
  );
  return (
    <div
      class="dropdown-menu nc-menu nc-agent-menu"
      on:keydown={(e) => {
        if (e.key !== 'Escape' || !(e.currentTarget as Element).querySelector('[aria-expanded="true"]')) return;
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <button type="button" class="nc-chip nc-trigger" aria-label="Agent" aria-haspopup="menu" aria-expanded="false">
        <span class="nc-trigger-body">
          {face()}
          {icons.chevronDown()}
        </span>
      </button>
      <div data-popover="" aria-hidden="true">
        <div role="menu" aria-label="Agent">
          <For each={providers()}>
            {(v) => (
              // biome-ignore lint/a11y/useFocusableInteractive: Basecoat's rows
              <div
                role="menuitemradio"
                aria-checked={provider() === v}
                on:click={() => {
                  setProvider(v);
                  const next = current.saved.providers.find((p) => p.name === v);
                  if (agentMode() === 'ui' && !canUseUi(next)) setAgentMode('tui');
                }}
              >
                {named(
                  providerIcon(current.saved.providers.find((p) => p.name === v)?.command ?? ''),
                  v || 'Agent',
                )}
                {provider() === v ? icons.check() : <span />}
              </div>
            )}
          </For>
          <div role="separator" class="nc-menu-sep" />
          <div class="nc-menu-label" aria-hidden="true">
            Mode
          </div>
          {(['tui', 'ui'] as const).map((mode) => {
            const disabled = mode === 'ui' && !canUseUi(prov());
            return (
              // biome-ignore lint/a11y/useFocusableInteractive: Basecoat's rows
              <div
                role="menuitemradio"
                aria-checked={agentMode() === mode}
                aria-disabled={disabled || undefined}
                data-disabled={disabled || undefined}
                on:click={() => {
                  if (!disabled) setAgentMode(mode);
                }}
              >
                <span class="nc-value">{mode === 'tui' ? 'TUI' : 'UI'}</span>
                {agentMode() === mode ? icons.check() : <span />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const named = (icon: () => SVGSVGElement, text: string): JSX.Element => [icon(), <span class="nc-value">{text}</span>];

// The New card dialog lives as long as the page.
export function NewCard(): JSX.Element {
  const cwd = (
    <input
      class="nc-search"
      name="cwd"
      placeholder="Search folders or type a path…"
      aria-label="Folder"
      autocomplete="off"
      spellcheck={false}
      on:input={() => setFolderText(cwd.value)}
    />
  ) as HTMLInputElement;
  const folderList = (
    <ul id="new-card-folders" class="picker-options nc-options" role="listbox" aria-label="Folders" hidden />
  ) as HTMLUListElement;

  tagsPanel = TagsPanel(
    () => pickedTags(),
    (next) => setPickedTags(next),
    () => tagsChip.close(),
  );
  let files!: HTMLInputElement;
  const folderChip = popChip(
    'Folder',
    () => (
      <span class="nc-trigger-body">
        {icons.folder()}
        <span class="nc-value" title={folderText()}>
          {folderText() || 'Folder'}
        </span>
      </span>
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
    () => (
      <span class="nc-trigger-body">
        {icons.tag()}
        {pickedTags().length ? pickedTags().map((t) => tagBadge(t)) : <span class="nc-value">Tags</span>}
      </span>
    ),
    () => {
      tagsPanel.close(); // so it lists the tags in use now
      tagsPanel.open(true);
    },
    tagsPanel.panel,
  );
  const providerFace = (v: string) =>
    named(providerIcon(current.saved.providers.find((p) => p.name === v)?.command ?? ''), v || 'Agent');
  const dialog = (
    <dialog
      ref={(el) => {
        host = el;
      }}
      id="new-card"
      class={`dialog new-card${big() ? ' big' : ''}${dragging() ? ' dragging' : ''}`}
      aria-labelledby="new-card-title"
      // The dialog is the overlay; a click on it, not on the form, is the backdrop.
      // The press must start there too: a text selection dragged out of the
      // form and released on the backdrop also clicks the dialog.
      on:pointerdown={(e) => {
        pressedBackdrop = e.target === e.currentTarget;
      }}
      on:click={(e) => {
        if (pressedBackdrop && e.target === e.currentTarget) (e.currentTarget as HTMLDialogElement).close();
        pressedBackdrop = false;
      }}
      on:close={() => {
        setDragging(false);
        clearImages();
      }}
      // Files dropped anywhere on the dialog (or its backdrop) are its own:
      // they never reach the terminal behind it (ui/drop.ts).
      on:dragenter={(e) => {
        if (!hasFiles(e)) return;
        e.stopPropagation();
        setDragging(true);
      }}
      on:dragover={(e) => {
        if (!hasFiles(e)) return;
        e.stopPropagation();
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
        setDragging(true);
      }}
      on:dragleave={(e) => {
        e.stopPropagation();
        if (!host.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      on:drop={(e) => {
        if (!hasFiles(e)) return;
        e.stopPropagation();
        e.preventDefault();
        setDragging(false);
        addImages(e.dataTransfer?.files ?? []);
      }}
    >
      <form
        ref={(el) => {
          formEl = el;
        }}
        method="dialog"
        id="new-card-form"
        on:submit={submit}
      >
        <header class="nc-head">
          <h2 id="new-card-title" class="sr-only">
            {editing() ? 'Edit card' : 'New card'}
          </h2>
          <div class="nc-crumbs">
            {/* An edited card stays in its folder. */}
            {editing() ? (
              <span class="nc-chip nc-fixed" title={folderText()}>
                {icons.folder()}
                <span class="nc-value">{folderText()}</span>
              </span>
            ) : (
              folderChip.node
            )}
            <span class="nc-sep" aria-hidden="true">
              {icons.chevronRight()}
            </span>
            <AgentMenu />
          </div>
          <div class="nc-tools">
            <button
              type="button"
              class="btn"
              data-variant="ghost"
              data-size="icon-sm"
              aria-label={big() ? 'Collapse' : 'Expand'}
              aria-pressed={big()}
              on:click={() => setBig(!big())}
            >
              {big() ? icons.shrink() : icons.expand()}
            </button>
            <button
              type="button"
              class="btn"
              data-variant="ghost"
              data-size="icon-sm"
              value="cancel"
              aria-label="Close"
              on:click={() => host.close()}
            >
              {icons.close()}
            </button>
          </div>
        </header>
        <section class="nc-body">
          <textarea
            ref={(el) => {
              promptEl = el;
            }}
            class="nc-prompt"
            name="prompt"
            rows={2}
            required
            aria-label="First prompt"
            placeholder="What should the agent do?"
            on:paste={(e) => {
              const pasted = [...(e.clipboardData?.files ?? [])].filter(isImage);
              if (!pasted.length) return;
              e.preventDefault(); // the image, not its file name as text
              addImages(pasted);
            }}
            on:keydown={(e) => {
              if (e.key === 'Enter' && (isMac ? e.metaKey : e.ctrlKey)) {
                e.preventDefault();
                formEl.requestSubmit();
              }
            }}
          />
          <div class="nc-thumbs" hidden={images().length === 0}>
            <For each={images()}>{(x) => <Thumb image={x} />}</For>
          </div>
        </section>
        <div class="nc-props">
          {/* An edited card stays in Backlog. */}
          <span class="nc-column" hidden={!!editing()}>
            <ChipMenu<Start>
              name="Column"
              items={['backlog', 'in_progress']}
              value={start}
              set={(v) => setStart(v)}
              face={(v) => named(() => glyph(v), STATUS_NAMES[v])}
            />
          </span>
          {tagsChip.node}
        </div>
        <p class="new-card-error" role="alert" hidden={error() === null}>
          {error() ?? ''}
        </p>
        <footer class="nc-foot">
          <button
            type="button"
            class="btn nc-attach"
            data-variant="outline"
            data-size="icon"
            aria-label="Attach images"
            title="Attach images (or drop them here)"
            on:click={() => files.click()}
          >
            {icons.paperclip()}
          </button>
          <input
            ref={files}
            type="file"
            accept="image/*"
            multiple
            hidden
            on:change={() => {
              addImages(files.files ?? []);
              files.value = '';
            }}
          />
          <label class="nc-more" hidden={!!editing()}>
            {/* biome-ignore lint/a11y/useAriaPropsForRole: a checkbox drawn as Basecoat's switch; its own checked state is the switch's */}
            <input type="checkbox" role="switch" class="input" name="more" />
            Create more
          </label>
          <button type="submit" class="btn" disabled={busy()}>
            {editing() ? (busy() ? 'Saving…' : 'Save') : busy() ? 'Creating…' : 'Create card'}
          </button>
        </footer>
        <div class="nc-drop" aria-hidden="true">
          {icons.paperclip()}
          <span>Drop images to attach</span>
        </div>
      </form>
    </dialog>
  );
  folder = initFolderPicker(cwd, folderList, () => {
    setFolderText(cwd.value);
    folderChip.close();
  });
  setNewCard(openNewCard);
  setEditCard(openEditCard);
  return dialog;
}
