// The welcome tour's dialog: one full-page screen per WELCOME_SCREENS entry,
// opened on first load (initWelcome) and again from the palette's Show
// welcome, walked with Continue, left with Skip.
// The view, theme, font, sound and agents screens carry their choices.
import { createEffect, createSignal, For, type JSX, Match, onCleanup, onMount, Show, Switch } from 'solid-js';
import { SETUP_PROMPT, type Status } from '../board/model.ts';
import { setStatus } from '../board/status.ts';
import { openSetupCard } from '../board/view.tsx';
import { gateMode } from '../daemon/client.ts';
import { go } from '../nav/router.ts';
import { FONTS, fontStack, THEMES, TYPING_SOUNDS } from '../settings/catalog.ts';
import { current, saveSetting, saveSettings } from '../settings/settings.ts';
import { keySound, loadPack, playSample, SOUND_PACKS } from '../sound/packs.ts';
import { glyph, type Icon, icons, providerIcon } from '../ui/icons.tsx';
import {
  agentSetupPatch,
  clampStep,
  closesAfterSetup,
  dismissWelcome,
  PREVIEW_COMMAND,
  typingBeats,
  viewChoice,
  viewSettings,
  WELCOME_SCREENS,
  welcomeFromQuery,
} from './steps.ts';

// Which screen is on show; showWelcome resets it.
const [step, setStep] = createSignal(0);
// The view picked on this opening, null until one is: its being set is also
// what makes closing move the app there.
const [pickedView, setPickedView] = createSignal<'kanban' | 'list' | null>(null);
// The agents screen's providers and the chosen one.
const [providers, setProviders] = createSignal<string[]>([]);
const [provider, setProvider] = createSignal('');
// The agents screen's setup card is on its way: Set up, Back and the two
// finish buttons wait.
const [busy, setBusy] = createSignal(false);
const [chosenTheme, setChosenTheme] = createSignal(current.saved.theme);
const [chosenFont, setChosenFont] = createSignal(current.saved.font);
const [chosenSound, setChosenSound] = createSignal<string | null>(null);

const on = () => WELCOME_SCREENS[step()];
// Every screen is a split. The title and description sit above the preview.
// The preview and the answer share a row and stay centered with each other.
const el = () => document.getElementById('welcome') as HTMLDialogElement;

// The view screen's two choices, as the saved layout names the chosen one.
const chosenView = (): 'kanban' | 'list' => viewChoice(current.saved.boardLayout);

function pickView(choice: 'kanban' | 'list'): void {
  saveSettings(viewSettings(choice));
  setPickedView(choice);
}

// Every way out of the tour lands here: the dialog closes and, if this
// opening picked a view, the router moves the app there. The last screen can
// ask for the split: the board and the terminal beside it, naming the setup
// card when there is one. It writes nothing — a caller saves first.
function closeWelcome(split = false, tab?: string): void {
  el().close();
  if (split) go({ view: 'board', drawer: true, ...(tab ? { tab } : {}) });
  else if (pickedView() !== null) go({ view: 'board' });
}

const VIEW_NAMES: Record<'kanban' | 'list', string> = { kanban: 'Kanban', list: 'List' };
const VIEW_DETAILS: Record<'kanban' | 'list', string> = {
  kanban: 'Cards grouped by work status.',
  list: 'The same cards in compact rows.',
};

interface PreviewFrame {
  chars: number;
  lines: number;
  caret: boolean;
}

const OUTPUT_COUNT = 5;
const fullPreview = (): PreviewFrame => ({ chars: PREVIEW_COMMAND.length, lines: OUTPUT_COUNT, caret: false });
const [typedPreview, setTypedPreview] = createSignal(fullPreview());
let typingTimer = 0;
let typingToken = 0;

function stopTyping(): void {
  window.clearTimeout(typingTimer);
  typingToken += 1;
  setTypedPreview(fullPreview());
}

// Types the preview command on the sound screen and plays the chosen pack
// for each key. The run's output then prints on its own, without clicks.
function playTyping(sound: string): void {
  const mine = ++typingToken;
  window.clearTimeout(typingTimer);
  setTypedPreview({ chars: 0, lines: 0, caret: true });
  const beats = typingBeats(PREVIEW_COMMAND, OUTPUT_COUNT);
  const run = () => {
    if (mine !== typingToken) return;
    let index = 0;
    const stepBeat = () => {
      if (mine !== typingToken || on().id !== 'sound') return;
      const beat = beats[index];
      if (!beat) {
        setTypedPreview({ chars: PREVIEW_COMMAND.length, lines: OUTPUT_COUNT, caret: true });
        return;
      }
      setTypedPreview({ chars: beat.chars, lines: beat.lines, caret: true });
      if (beat.key && sound !== 'off') {
        const release = keySound(sound, beat.key);
        if (release) window.setTimeout(() => playSample(release), 48);
      }
      index += 1;
      typingTimer = window.setTimeout(stepBeat, beat.key ? 72 : 40);
    };
    stepBeat();
  };
  if (SOUND_PACKS[sound]) loadPack(sound).then(run, run);
  else run();
}

const themePreviewColors = (id: string): string[] => {
  const c = THEMES[id].colors;
  return [c.background, c.foreground, c.blue, c.green, c.yellow, c.red, c.magenta, c.cyan];
};

function Ghost(props: { icon: Icon; extra?: string }): JSX.Element {
  return (
    <button type="button" class={`btn ${props.extra ?? ''}`} data-variant="ghost" data-size="icon-sm" tabindex="-1">
      {props.icon()}
    </button>
  );
}

function PreviewTab(props: { status: Status; name: string; selected?: boolean }): JSX.Element {
  return (
    // biome-ignore lint/a11y/useFocusableInteractive: preview chrome only; aria-hidden on the stage
    <div class="tab" role="tab" aria-selected={!!props.selected}>
      <i class="tab-status" data-status={props.status}>
        {glyph(props.status)}
      </i>
      <span class="tab-name">{props.name}</span>
      <Show when={props.selected}>
        <button type="button" class="btn" data-variant="ghost" data-size="icon-xs" tabindex="-1">
          {icons.close()}
        </button>
      </Show>
    </div>
  );
}

function PreviewColumn(props: {
  status: Status;
  name: string;
  count: string;
  plus: boolean;
  card?: JSX.Element;
  row?: JSX.Element;
}): JSX.Element {
  return (
    <section class="board-col" data-status={props.status}>
      <header>
        <span class="welcome-preview-kanban-head">
          <i class="status-glyph" data-status={props.status}>
            {glyph(props.status)}
          </i>
          <span class="col-name">{props.name}</span>
          <span class="col-count">{props.count}</span>
        </span>
        <button type="button" class="col-toggle" tabindex="-1">
          {icons.chevronDown()}
          <i class="status-glyph" data-status={props.status}>
            {glyph(props.status)}
          </i>
          <span class="col-name">{props.name}</span>
          <span class="col-count">{props.count}</span>
        </button>
        <Show when={props.plus}>
          <button type="button" class="btn" data-variant="ghost" data-size="icon-xs" tabindex="-1">
            {icons.plus()}
          </button>
        </Show>
      </header>
      <div class="board-cards">
        {props.card}
        {props.row}
      </div>
    </section>
  );
}

function PreviewCaret(): JSX.Element {
  return <span class="welcome-preview-caret" />;
}

function OutputLine(props: { index: number }): JSX.Element {
  const i = props.index;
  if (i === 0)
    return (
      <div>
        <span class="ok">Compiling</span>
        {' api v0.4.1 (~/code/api)'}
      </div>
    );
  if (i === 1)
    return (
      <div>
        <span class="ok">Finished</span>
        {' `test` profile [unoptimized + debuginfo] in 3.42s'}
      </div>
    );
  if (i === 2)
    return (
      <div>
        <span class="ok">Running</span>
        {' unittests src/lib.rs'}
      </div>
    );
  if (i === 3)
    return (
      <div>
        {'test auth::login ... '}
        <span class="ok">ok</span>
      </div>
    );
  return (
    <div>
      {'test result: '}
      <span class="ok">ok</span>
      {'. 48 passed; 0 failed; finished in 0.81s'}
    </div>
  );
}

function TerminalFrame(props: { frame: PreviewFrame }): JSX.Element {
  const cmd = () => PREVIEW_COMMAND.slice(0, props.frame.chars);
  const lines = () => Array.from({ length: props.frame.lines }, (_, i) => i);
  return (
    <div>
      <div>
        <span>~/code/api </span>
        <span class="ok">❯</span>
        {cmd() ? ` ${cmd()}` : ''}
        <Show when={props.frame.caret && props.frame.lines === 0}>
          <PreviewCaret />
        </Show>
      </div>
      <For each={lines()}>{(i) => <OutputLine index={i} />}</For>
      <Show when={props.frame.lines >= OUTPUT_COUNT}>
        <div>
          <span>~/code/api </span>
          <span class="ok">❯</span>
          <Show when={props.frame.caret}>
            <PreviewCaret />
          </Show>
        </div>
      </Show>
    </div>
  );
}

function TabshIcon(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'welcome-browser-tab-icon');
  svg.setAttribute('viewBox', '0 0 32 32');
  svg.setAttribute('aria-hidden', 'true');
  const rect = document.createElementNS(svg.namespaceURI, 'rect');
  rect.setAttribute('width', '32');
  rect.setAttribute('height', '32');
  rect.setAttribute('rx', '7');
  rect.setAttribute('fill', '#18181b');
  const path = document.createElementNS(svg.namespaceURI, 'path');
  path.setAttribute('d', 'M8 11l5 5-5 5M15 22h9');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', '#e4e4e7');
  path.setAttribute('stroke-width', '2.6');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(rect, path);
  return svg;
}

// A neighbouring browser tab in the preview chrome. The open tab is tabsh;
// these sit beside it so the window looks like a normal browser.
function BrowserTab(props: { name: string; mark: string }): JSX.Element {
  return (
    <span class="welcome-browser-tab" data-open="false">
      <span class="welcome-browser-mark" style={{ background: props.mark }} />
      {props.name}
    </span>
  );
}

function ChoiceCard(props: {
  label: string;
  detail: string;
  selected: () => boolean;
  preview?: JSX.Element;
  onclick: () => void;
}): JSX.Element {
  return (
    <button type="button" class="welcome-choice-card" aria-pressed={props.selected()} on:click={props.onclick}>
      <span class="welcome-choice-radio" aria-hidden="true" />
      <span class="welcome-choice-copy">
        <span class="welcome-choice-name">{props.label}</span>
        <span class="welcome-choice-detail">{props.detail}</span>
      </span>
      {props.preview}
    </button>
  );
}

function ScrollChoiceList(props: { children: JSX.Element }): JSX.Element {
  let list!: HTMLDivElement;
  const update = () => {
    if (!list.isConnected) return;
    const end = list.scrollHeight - list.clientHeight;
    list.classList.toggle('fade-top', list.scrollTop > 1);
    list.classList.toggle('fade-bottom', end > 1 && list.scrollTop < end - 1);
  };
  onMount(() => {
    const observer = new ResizeObserver(update);
    observer.observe(list);
    list.addEventListener('scroll', update, { passive: true });
    update();
    onCleanup(() => observer.disconnect());
  });
  return (
    <div ref={list} class="welcome-choice-list welcome-scroll-list">
      {props.children}
    </div>
  );
}

function IntroMessage(): JSX.Element {
  return (
    <section class="welcome-intro-message">
      <span class="welcome-intro-kicker">Why a browser tab?</span>
      <ul class="welcome-intro-list">
        <li>
          <strong>Work already happens in tabs.</strong>
          {' Issues, pull requests, docs, chats, AI, and localhost apps are already in your browser.'}
        </li>
        <li>
          <strong>Keep the real thing open.</strong>
          {' Tabsh leaves GitHub as GitHub, Slack as Slack, and makes your shells and agents one more tab beside them.'}
        </li>
        <li>
          <strong>Switch less, stay with the work.</strong>
          {
            ' Your shells and agents sit next to the thing they build, so your train of thought has fewer places to fall off.'
          }
        </li>
      </ul>
    </section>
  );
}

function ViewChoices(props: { selected: () => 'kanban' | 'list' }): JSX.Element {
  return (
    <div class="welcome-choice-panel">
      <div class="welcome-choice-list welcome-view-list">
        <For each={['kanban', 'list'] as const}>
          {(choice) => (
            <ChoiceCard
              label={VIEW_NAMES[choice]}
              detail={VIEW_DETAILS[choice]}
              selected={() => props.selected() === choice}
              onclick={() => pickView(choice)}
            />
          )}
        </For>
      </div>
    </div>
  );
}

function ThemeChoices(props: { chosen: () => string }): JSX.Element {
  return (
    <div class="welcome-choice-panel">
      <ScrollChoiceList>
        <For each={Object.entries(THEMES)}>
          {([id, t]) => (
            <ChoiceCard
              label={t.name}
              detail={
                t.system
                  ? 'Follows your system setting.'
                  : t.light
                    ? 'A light terminal palette.'
                    : 'A dark terminal palette.'
              }
              selected={() => props.chosen() === id}
              preview={
                <span class="welcome-choice-swatch" aria-hidden="true">
                  <For each={themePreviewColors(id)}>{(color) => <span style={{ '--swatch': color }} />}</For>
                </span>
              }
              onclick={() => {
                setChosenTheme(id);
                saveSetting('theme', id);
              }}
            />
          )}
        </For>
      </ScrollChoiceList>
    </div>
  );
}

function FontChoices(props: { chosen: () => string }): JSX.Element {
  return (
    <div class="welcome-choice-panel">
      <ScrollChoiceList>
        <For each={Object.entries(FONTS)}>
          {([id, f]) => (
            <ChoiceCard
              label={f.name}
              detail={f.google ? 'Loaded for the terminal.' : 'Uses your system font stack.'}
              selected={() => props.chosen() === id}
              preview={
                <span class="welcome-choice-sample" style={{ '--choice-font': fontStack(f) }} aria-hidden="true">
                  Aa
                </span>
              }
              onclick={() => {
                setChosenFont(id);
                saveSetting('font', id);
              }}
            />
          )}
        </For>
      </ScrollChoiceList>
    </div>
  );
}

const SOUND_DETAILS: Record<string, string> = {
  'mx-black-pbt': 'A quiet linear press.',
  'mx-blue': 'A click on every key.',
  'holy-panda': 'A soft tactile bump.',
  'gateron-black-ink': 'A deep, muted press.',
  off: 'Silence.',
};

function SoundChoices(props: { chosen: () => string | null }): JSX.Element {
  return (
    <div class="welcome-choice-panel">
      <div class="welcome-choice-list">
        <For each={Object.entries(TYPING_SOUNDS)}>
          {([id, name]) => (
            <ChoiceCard
              label={name}
              detail={SOUND_DETAILS[id] ?? ''}
              selected={() => props.chosen() === id}
              onclick={() => {
                setChosenSound(id);
                saveSetting('typingSound', id);
                playTyping(id);
              }}
            />
          )}
        </For>
      </div>
    </div>
  );
}

function AgentChoices(props: { names: () => string[]; chosen: () => string }): JSX.Element {
  const [copied, setCopied] = createSignal(false);
  let copyTimer = 0;
  const copyPrompt = () => {
    navigator.clipboard.writeText(SETUP_PROMPT).then(
      () => {
        setCopied(true);
        window.clearTimeout(copyTimer);
        copyTimer = window.setTimeout(() => setCopied(false), 1500);
      },
      () => {},
    );
  };
  return (
    <div class="welcome-choice-panel welcome-agent-panel">
      <div class="welcome-choice-list welcome-agent-list">
        <For each={props.names()}>
          {(name) => {
            const command = current.saved.providers.find((p) => p.name === name)?.command ?? '';
            return (
              <ChoiceCard
                label={name}
                detail={command}
                selected={() => props.chosen() === name}
                preview={
                  <span class="welcome-choice-agent" aria-hidden="true">
                    {providerIcon(command)()}
                  </span>
                }
                onclick={() => {
                  setProvider(name);
                  saveSetting('agentProvider', name);
                }}
              />
            );
          }}
        </For>
      </div>
      <div class="welcome-or">Or copy to your coding agent</div>
      <pre class="welcome-prompt">
        <span class="welcome-prompt-mark">{'>'}</span>
        {` ${SETUP_PROMPT}  `}
        <button type="button" class="welcome-prompt-copy" aria-label="Copy setup prompt" on:click={copyPrompt}>
          {copied() ? '[copied]' : '[copy]'}
        </button>
      </pre>
    </div>
  );
}

// The agents screen's Set up: opens the chosen provider's setup card, and
// only then saves the patch that ends the tour and deals with the board in
// one write, starts the card's agent, and closes. A card that didn't open
// leaves the dialog on Agents, nothing saved.
async function setUpAgent(): Promise<void> {
  if (busy()) return;
  const chosen = current.saved.providers.find((p) => p.name === provider()) ?? current.saved.providers[0];
  if (!chosen) return;
  // Choosing a layout this opening puts the setup card on the board without
  // pulling the terminal in front of it; otherwise the new tab takes focus.
  const toBoard = pickedView() !== null;
  setBusy(true);
  const s = await openSetupCard({ command: chosen.command, resume: chosen.resume, focus: !toBoard });
  if (!closesAfterSetup(s !== null) || s === null) {
    setBusy(false);
    return;
  }
  saveSettings(agentSetupPatch(chosen.name));
  await setStatus(s, 'in_progress').catch(console.error); // starts its agent
  setBusy(false);
  closeWelcome(true, s.id);
}

function AppPreview(props: {
  selected: () => 'kanban' | 'list';
  theme: () => string;
  font: () => string;
}): JSX.Element {
  const shopCard = (
    <article class="board-card">
      <div class="card-top">
        <span class="card-title">shop: npm run dev</span>
        <i class="status-glyph" data-status="in_progress">
          {glyph('in_progress')}
        </i>
        {icons.more()}
      </div>
      <div class="card-meta">
        {icons.folder()}
        <span>~/code/shop</span>
      </div>
      <div class="card-meta">
        <span>2m</span>
      </div>
    </article>
  );
  const claudeCard = (
    <article class="board-card">
      <div class="card-top">
        <span class="card-title">claude</span>
        <i class="status-glyph" data-status="needs_input">
          {glyph('needs_input')}
        </i>
        {icons.more()}
      </div>
      <div class="card-meta">
        {icons.folder()}
        <span>~/code/shop</span>
      </div>
      <div class="card-note">Run the tests before I commit?</div>
      <div class="card-meta">
        <span class="card-agent">{icons.claude()}</span>
        <span>4m</span>
      </div>
    </article>
  );
  const shopRow = (
    <article class="board-card board-row">
      <i class="status-glyph" data-status="in_progress">
        {glyph('in_progress')}
      </i>
      <span class="card-title">shop: npm run dev</span>
      <div class="row-end">
        <span class="card-meta row-folder">
          {icons.folder()}
          <span>~/code/shop</span>
        </span>
        <span class="card-meta row-since">3m</span>
        {icons.more()}
      </div>
    </article>
  );
  const claudeRow = (
    <article class="board-card board-row">
      <i class="status-glyph" data-status="needs_input">
        {glyph('needs_input')}
      </i>
      <span class="card-title">claude</span>
      <div class="row-end">
        <span class="row-note">Run the tests before I commit?</span>
        <span class="card-meta row-folder">
          {icons.folder()}
          <span>~/code/shop</span>
        </span>
        <span class="card-agent">{icons.claude()}</span>
        <span class="card-meta row-since">5m</span>
        {icons.more()}
      </div>
    </article>
  );
  const doneRow = (
    <article class="board-card board-row">
      <i class="status-glyph" data-status="completed">
        {glyph('completed')}
      </i>
      <span class="card-title">api: cargo test</span>
      <div class="row-end">
        <span class="card-meta row-folder">
          {icons.folder()}
          <span>~/code/api</span>
        </span>
        <span class="card-meta row-since">4m</span>
        {icons.more()}
      </div>
    </article>
  );
  const previewStyle = () => {
    const c = THEMES[props.theme()].colors;
    const f = FONTS[props.font()];
    const bg = c.background;
    const fg = c.foreground;
    return {
      '--preview-accent': c.green,
      '--preview-font': fontStack(f),
      '--background': bg,
      '--foreground': fg,
      '--muted': `color-mix(in srgb, ${fg} 8%, ${bg})`,
      '--muted-foreground': `color-mix(in srgb, ${fg} 60%, ${bg})`,
      '--border': `color-mix(in srgb, ${fg} 14%, ${bg})`,
      '--card': `color-mix(in srgb, ${fg} 4%, ${bg})`,
      '--card-foreground': fg,
    } as JSX.CSSProperties;
  };
  return (
    <div class="welcome-stage">
      <div class="welcome-browser">
        <div class="welcome-browser-chrome">
          <span class="welcome-browser-lights">
            <i />
            <i />
            <i />
          </span>
          <BrowserTab name="GitHub" mark="#f0f0f0" />
          <BrowserTab name="Slack" mark="#e01e5a" />
          <span class="welcome-browser-tab">
            {TabshIcon()}
            tabsh
            <span class="welcome-browser-x">×</span>
          </span>
          <BrowserTab name="Notion" mark="#fff" />
        </div>
        <div class="welcome-browser-urlbar">
          <span class="welcome-browser-url">tabsh.cc/app</span>
        </div>
        <div class="welcome-app-preview" data-kind={props.selected()} aria-hidden="true" style={previewStyle()}>
          <div class="welcome-preview-fit">
            <div class="tabbar welcome-preview-terms">
              <Ghost icon={icons.board} />
              <Ghost icon={icons.explorer} />
              <div class="welcome-preview-tabs">
                <PreviewTab status="in_progress" name="shop: npm run dev" />
                <PreviewTab status="completed" name="api: cargo test" selected />
                <PreviewTab status="needs_input" name="claude" />
              </div>
              <Ghost icon={icons.plus} />
              <Ghost icon={icons.group} />
              <Ghost icon={icons.settings} extra="settings-btn" />
            </div>
            <div class="tabbar welcome-preview-boardbar">
              <Ghost icon={icons.board} extra="welcome-preview-board-icon" />
              <Ghost icon={icons.rows} extra="welcome-preview-rows" />
              <Ghost icon={icons.listFilter} extra="welcome-preview-filter" />
              <Ghost icon={icons.settings} extra="settings-btn" />
            </div>
            <div class="welcome-preview-stage">
              <div class={`welcome-preview-board${props.selected() === 'list' ? ' list' : ''}`}>
                <PreviewColumn status="backlog" name="Backlog" count="0" plus />
                <PreviewColumn status="in_progress" name="In progress" count="1" plus card={shopCard} row={shopRow} />
                <PreviewColumn
                  status="needs_input"
                  name="Needs input"
                  count="1"
                  plus={false}
                  card={claudeCard}
                  row={claudeRow}
                />
                <PreviewColumn status="completed" name="Completed" count="1" plus={false} row={doneRow} />
                <PreviewColumn status="archived" name="Archived" count="0" plus={false} />
              </div>
              <div class="welcome-preview-drawer">
                <header class="drawer-bar">
                  <Ghost icon={icons.arrowRightToLine} />
                  <Ghost icon={icons.explorer} />
                  <span class="drawer-title">api: cargo test</span>
                  <span class="drawer-move-label">
                    <i class="status-glyph" data-status="completed">
                      {glyph('completed')}
                    </i>
                    Completed
                    {icons.chevronDown()}
                  </span>
                  <Ghost icon={icons.expand} />
                </header>
                <div class="welcome-preview-terminal">
                  <TerminalFrame frame={typedPreview()} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function Welcome(): JSX.Element {
  const step$ = step;
  const picked$ = pickedView;
  const providers$ = providers;
  const provider$ = provider;
  const theme$ = chosenTheme;
  const font$ = chosenFont;
  const sound$ = chosenSound;
  const screen = () => WELCOME_SCREENS[step$()];
  const selected = (): 'kanban' | 'list' => picked$() ?? chosenView();

  createEffect(() => {
    if (screen().id !== 'sound') stopTyping();
  });

  const titleStyle = () => {
    if (screen().id !== 'font') return undefined;
    const face = FONTS[font$()];
    return face ? { 'font-family': fontStack(face) } : undefined;
  };

  return (
    <dialog
      id="welcome"
      aria-label="Welcome"
      // A person expects Escape to dismiss a dialog; this one stays up.
      on:cancel={(e) => e.preventDefault()}
    >
      <div class="welcome-page" data-layout="split" data-screen={screen().id}>
        <div class="welcome-question">
          <h2 class="welcome-title" style={titleStyle()}>
            {screen().title}
          </h2>
          <p class="welcome-text">{screen().body}</p>
        </div>
        <div class="welcome-visual">
          <AppPreview selected={selected} theme={theme$} font={font$} />
        </div>
        <div class="welcome-main">
          <div class="welcome-body">
            <Switch fallback={<div style={{ display: 'none' }} />}>
              <Match when={screen().id === 'intro'}>
                <IntroMessage />
              </Match>
              <Match when={screen().id === 'view'}>
                <ViewChoices selected={selected} />
              </Match>
              <Match when={screen().id === 'theme'}>
                <ThemeChoices chosen={theme$} />
              </Match>
              <Match when={screen().id === 'font'}>
                <FontChoices chosen={font$} />
              </Match>
              <Match when={screen().id === 'sound'}>
                <SoundChoices chosen={sound$} />
              </Match>
              <Match when={screen().id === 'agents'}>
                <AgentChoices names={providers$} chosen={provider$} />
              </Match>
            </Switch>
          </div>
          <footer class="welcome-foot">
            <div class="welcome-dots" aria-hidden="true">
              <For each={WELCOME_SCREENS}>
                {(_, i) => <span class="welcome-dot" aria-current={step$() === i() ? 'step' : undefined} />}
              </For>
            </div>
            <div class="welcome-actions">
              <button
                type="button"
                class="btn"
                data-variant="ghost"
                hidden={step$() === 0}
                disabled={busy()}
                on:click={() => {
                  setStep(clampStep(step() - 1));
                }}
              >
                Back
              </button>
              <button
                type="button"
                class="btn"
                data-variant="ghost"
                hidden={!screen().skip}
                disabled={busy()}
                on:click={() => {
                  saveSetting('welcomeSeen', dismissWelcome().welcomeSeen);
                  closeWelcome();
                }}
              >
                Skip
              </button>
              <Show when={screen().setup}>
                {/* The explicit way past the last screen without wiring an
                    agent: the board's own setup screen still waits. */}
                <button
                  type="button"
                  class="btn"
                  data-variant="ghost"
                  disabled={busy()}
                  on:click={() => {
                    saveSettings(dismissWelcome());
                    closeWelcome(true);
                  }}
                >
                  Finish without setup
                </button>
                <button type="button" class="btn" autofocus disabled={busy()} on:click={() => void setUpAgent()}>
                  {busy() ? 'Setting up…' : 'Set up'}
                </button>
              </Show>
              <Show when={!screen().setup}>
                <button
                  type="button"
                  class="btn"
                  // showModal() would put the first focus on Skip (Back is hidden
                  // at step 0), and an accidental Enter there ends the tour for
                  // good: focus lands on the safe button instead.
                  autofocus
                  on:click={() => setStep(clampStep(step() + 1))}
                >
                  Continue
                </button>
              </Show>
            </div>
          </footer>
        </div>
      </div>
    </dialog>
  );
}

// Opens the tour on its first screen; held off while the gate is up — the
// connection comes first.
export function showWelcome(): void {
  if (gateMode() !== null) return;
  // The palette is a modal too, so it goes first — opening the tour over it
  // would throw. Its close listener walks the place back, exactly as Esc does.
  const palette = document.getElementById('palette') as HTMLDialogElement | null;
  if (palette?.open) palette.close();
  setStep(0);
  setPickedView(null);
  setBusy(false);
  const names = current.saved.providers.map((p) => p.name);
  setProviders(names);
  // The dropdown starts on the provider New card offers first.
  setProvider(names.includes(current.saved.agentProvider) ? current.saved.agentProvider : (names[0] ?? ''));
  setChosenTheme(current.saved.theme);
  setChosenFont(current.saved.font);
  setChosenSound(null);
  el().showModal();
}

// Drops `welcome` from the address so the trigger fires once per link, and
// the router's later rewrite does not keep it.
function takeWelcomeQuery(): boolean {
  const params = new URLSearchParams(location.search);
  if (!welcomeFromQuery(params)) return false;
  params.delete('welcome');
  const search = params.toString();
  history.replaceState(null, '', location.pathname + (search ? `?${search}` : '') + location.hash);
  return true;
}

// Called once the daemon has answered and the settings are in: the tour is
// for someone tabsh hasn't met yet, and for a `?welcome=1` link.
export function initWelcome(): void {
  const asked = takeWelcomeQuery();
  if (asked || !current.saved.welcomeSeen) showWelcome();
}
