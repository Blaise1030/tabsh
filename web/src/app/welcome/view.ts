// The welcome tour's dialog: one full-page screen per WELCOME_SCREENS entry,
// opened on first load (initWelcome) and again from the palette's Show
// welcome, walked with Continue, left with Skip.
// The view, theme, font, sound and agents screens carry their choices.
import van, { type State } from 'vanjs-core';
import { SETUP_PROMPT, type Status } from '../board/model.ts';
import { gateMode } from '../daemon/client.ts';
import { go } from '../nav/router.ts';
import { FONTS, fontStack, THEMES, TYPING_SOUNDS } from '../settings/catalog.ts';
import { current, saveSetting, saveSettings } from '../settings/settings.ts';
import { keySound, loadPack, playSample, SOUND_PACKS } from '../sound/packs.ts';
import { glyph, type Icon, icons, providerIcon } from '../ui/icons.ts';
import {
  clampStep,
  dismissWelcome,
  PREVIEW_COMMAND,
  typingBeats,
  viewChoice,
  viewSettings,
  WELCOME_SCREENS,
  welcomeFromQuery,
} from './steps.ts';

const { article, button, dialog, div, footer, h2, header, i, li, p, pre, section, span, strong, ul } = van.tags;

// Which screen is on show; showWelcome resets it.
const step = van.state(0);
// The view picked on this opening, null until one is: its being set is also
// what makes closing move the app there.
const pickedView = van.state<'tabs' | 'kanban' | 'list' | null>(null);
// The agents screen's providers and the chosen one.
const providers: State<string[]> = van.state([]);
const provider: State<string> = van.state('');
const chosenTheme: State<string> = van.state(current.saved.theme);
const chosenFont: State<string> = van.state(current.saved.font);
const chosenSound: State<string | null> = van.state(null);

const on = () => WELCOME_SCREENS[step.val];
// Every screen is a split. The title and description sit above the preview.
// The preview and the answer share a row and stay centered with each other.
const el = () => document.getElementById('welcome') as HTMLDialogElement;

// The view screen's three choices, as the saved settings name the chosen one.
const chosenView = (): 'tabs' | 'kanban' | 'list' => viewChoice(current.saved.startView, current.saved.boardLayout);

function pickView(choice: 'tabs' | 'kanban' | 'list'): void {
  saveSettings(viewSettings(choice, current.saved.boardLayout));
  pickedView.val = choice;
}

// Every way out of the tour lands here: the dialog closes and, if this
// opening picked a view, the router moves the app there. It writes nothing —
// a caller saves first.
function closeWelcome(): void {
  el().close();
  if (pickedView.val !== null) go({ view: current.saved.startView });
}

const VIEW_NAMES: Record<'tabs' | 'kanban' | 'list', string> = { tabs: 'Tabs', kanban: 'Kanban', list: 'List' };
const VIEW_DETAILS: Record<'tabs' | 'kanban' | 'list', string> = {
  tabs: 'A terminal strip for quick switching.',
  kanban: 'Cards grouped by work status.',
  list: 'The same cards in compact rows.',
};

const selectedView = (): 'tabs' | 'kanban' | 'list' => pickedView.val ?? chosenView();

function ViewChoices(): HTMLElement {
  return div(
    { class: 'welcome-choice-panel' },
    div(
      { class: 'welcome-choice-list welcome-view-list' },
      ...(['tabs', 'kanban', 'list'] as const).map((choice) =>
        choiceCard({
          label: VIEW_NAMES[choice],
          detail: VIEW_DETAILS[choice],
          selected: () => selectedView() === choice,
          onclick: () => pickView(choice),
        }),
      ),
    ),
  );
}

const themePreviewColors = (id: string): string[] => {
  const c = THEMES[id].colors;
  return [c.background, c.foreground, c.blue, c.green, c.yellow, c.red, c.magenta, c.cyan];
};

const ghost = (icon: Icon, extra = '') =>
  button(
    { type: 'button', class: `btn ${extra}`, 'data-variant': 'ghost', 'data-size': 'icon-sm', tabindex: '-1' },
    icon(),
  );

function previewTab(status: Status, name: string, selected = false): HTMLElement {
  return div(
    { class: 'tab', role: 'tab', 'aria-selected': String(selected) },
    i({ class: 'tab-status', 'data-status': status }, glyph(status)),
    span({ class: 'tab-name' }, name),
    selected
      ? button(
          { type: 'button', class: 'btn', 'data-variant': 'ghost', 'data-size': 'icon-xs', tabindex: '-1' },
          icons.close(),
        )
      : '',
  );
}

function previewColumn(
  status: Status,
  name: string,
  count: string,
  plus: boolean,
  card?: HTMLElement,
  row?: HTMLElement,
): HTMLElement {
  return section(
    { class: 'board-col', 'data-status': status },
    header(
      span(
        { class: 'welcome-preview-kanban-head' },
        i({ class: 'status-glyph', 'data-status': status }, glyph(status)),
        span({ class: 'col-name' }, name),
        span({ class: 'col-count' }, count),
      ),
      button(
        { type: 'button', class: 'col-toggle', tabindex: '-1' },
        icons.chevronDown(),
        i({ class: 'status-glyph', 'data-status': status }, glyph(status)),
        span({ class: 'col-name' }, name),
        span({ class: 'col-count' }, count),
      ),
      plus
        ? button(
            { type: 'button', class: 'btn', 'data-variant': 'ghost', 'data-size': 'icon-xs', tabindex: '-1' },
            icons.plus(),
          )
        : '',
    ),
    div({ class: 'board-cards' }, card ?? '', row ?? ''),
  );
}

interface PreviewFrame {
  chars: number;
  lines: number;
  caret: boolean;
}

const OUTPUT_COUNT = 5;
const fullPreview = (): PreviewFrame => ({ chars: PREVIEW_COMMAND.length, lines: OUTPUT_COUNT, caret: false });
const typedPreview: State<PreviewFrame> = van.state(fullPreview());
let typingTimer = 0;
let typingToken = 0;

function stopTyping(): void {
  window.clearTimeout(typingTimer);
  typingToken += 1;
  typedPreview.val = fullPreview();
}

// Types the preview command on the sound screen and plays the chosen pack
// for each key. The run's output then prints on its own, without clicks.
function playTyping(sound: string): void {
  const mine = ++typingToken;
  window.clearTimeout(typingTimer);
  typedPreview.val = { chars: 0, lines: 0, caret: true };
  const beats = typingBeats(PREVIEW_COMMAND, OUTPUT_COUNT);
  const run = () => {
    if (mine !== typingToken) return;
    let index = 0;
    const stepBeat = () => {
      if (mine !== typingToken || on().id !== 'sound') return;
      const beat = beats[index];
      if (!beat) {
        typedPreview.val = { chars: PREVIEW_COMMAND.length, lines: OUTPUT_COUNT, caret: true };
        return;
      }
      typedPreview.val = { chars: beat.chars, lines: beat.lines, caret: true };
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

function previewCaret(): HTMLElement {
  return span({ class: 'welcome-preview-caret' });
}

function outputLine(index: number): HTMLElement {
  if (index === 0) return div(span({ class: 'ok' }, 'Compiling'), ' api v0.4.1 (~/code/api)');
  if (index === 1) return div(span({ class: 'ok' }, 'Finished'), ' `test` profile [unoptimized + debuginfo] in 3.42s');
  if (index === 2) return div(span({ class: 'ok' }, 'Running'), ' unittests src/lib.rs');
  if (index === 3) return div('test auth::login ... ', span({ class: 'ok' }, 'ok'));
  return div('test result: ', span({ class: 'ok' }, 'ok'), '. 48 passed; 0 failed; finished in 0.81s');
}

function terminalFrame(frame: PreviewFrame): HTMLElement {
  const cmd = PREVIEW_COMMAND.slice(0, frame.chars);
  const lines: HTMLElement[] = [];
  for (let i = 0; i < frame.lines; i++) lines.push(outputLine(i));
  return div(
    div(
      span('~/code/api '),
      span({ class: 'ok' }, '❯'),
      cmd ? ` ${cmd}` : '',
      frame.caret && frame.lines === 0 ? previewCaret() : '',
    ),
    ...lines,
    frame.lines >= OUTPUT_COUNT
      ? div(span('~/code/api '), span({ class: 'ok' }, '❯'), frame.caret ? previewCaret() : '')
      : '',
  );
}

function tabshIcon(): SVGSVGElement {
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
function browserTab(name: string, mark: string): HTMLElement {
  return span(
    { class: 'welcome-browser-tab', 'data-open': 'false' },
    span({ class: 'welcome-browser-mark', style: `background:${mark}` }),
    name,
  );
}

function AppPreview(): HTMLElement {
  const shopCard = article(
    { class: 'board-card' },
    div(
      { class: 'card-top' },
      span({ class: 'card-title' }, 'shop: npm run dev'),
      i({ class: 'status-glyph', 'data-status': 'in_progress' }, glyph('in_progress')),
      icons.more(),
    ),
    div({ class: 'card-meta' }, icons.folder(), span('~/code/shop')),
    div({ class: 'card-meta' }, span('2m')),
  );
  const claudeCard = article(
    { class: 'board-card' },
    div(
      { class: 'card-top' },
      span({ class: 'card-title' }, 'claude'),
      i({ class: 'status-glyph', 'data-status': 'needs_input' }, glyph('needs_input')),
      icons.more(),
    ),
    div({ class: 'card-meta' }, icons.folder(), span('~/code/shop')),
    div({ class: 'card-note' }, 'Run the tests before I commit?'),
    div({ class: 'card-meta' }, span({ class: 'card-agent' }, icons.claude()), span('4m')),
  );
  const shopRow = article(
    { class: 'board-card board-row' },
    i({ class: 'status-glyph', 'data-status': 'in_progress' }, glyph('in_progress')),
    span({ class: 'card-title' }, 'shop: npm run dev'),
    div(
      { class: 'row-end' },
      span({ class: 'card-meta row-folder' }, icons.folder(), span('~/code/shop')),
      span({ class: 'card-meta row-since' }, '3m'),
      icons.more(),
    ),
  );
  const claudeRow = article(
    { class: 'board-card board-row' },
    i({ class: 'status-glyph', 'data-status': 'needs_input' }, glyph('needs_input')),
    span({ class: 'card-title' }, 'claude'),
    div(
      { class: 'row-end' },
      span({ class: 'row-note' }, 'Run the tests before I commit?'),
      span({ class: 'card-meta row-folder' }, icons.folder(), span('~/code/shop')),
      span({ class: 'card-agent' }, icons.claude()),
      span({ class: 'card-meta row-since' }, '5m'),
      icons.more(),
    ),
  );
  const doneRow = article(
    { class: 'board-card board-row' },
    i({ class: 'status-glyph', 'data-status': 'completed' }, glyph('completed')),
    span({ class: 'card-title' }, 'api: cargo test'),
    div(
      { class: 'row-end' },
      span({ class: 'card-meta row-folder' }, icons.folder(), span('~/code/api')),
      span({ class: 'card-meta row-since' }, '4m'),
      icons.more(),
    ),
  );
  return div(
    { class: 'welcome-stage' },
    div(
      { class: 'welcome-browser' },
      div(
        { class: 'welcome-browser-chrome' },
        span({ class: 'welcome-browser-lights' }, i(), i(), i()),
        browserTab('GitHub', '#f0f0f0'),
        browserTab('Slack', '#e01e5a'),
        span({ class: 'welcome-browser-tab' }, tabshIcon(), 'tabsh', span({ class: 'welcome-browser-x' }, '×')),
        browserTab('Notion', '#fff'),
      ),
      div({ class: 'welcome-browser-urlbar' }, span({ class: 'welcome-browser-url' }, 'tabsh.cc/app')),
      div(
        {
          class: 'welcome-app-preview',
          'data-kind': () => selectedView(),
          'aria-hidden': 'true',
          style: () => {
            const c = THEMES[chosenTheme.val].colors;
            const f = FONTS[chosenFont.val];
            const bg = c.background;
            const fg = c.foreground;
            return [
              `--preview-accent:${c.green}`,
              `--preview-font:${fontStack(f)}`,
              `--background:${bg}`,
              `--foreground:${fg}`,
              `--muted:color-mix(in srgb, ${fg} 8%, ${bg})`,
              `--muted-foreground:color-mix(in srgb, ${fg} 60%, ${bg})`,
              `--border:color-mix(in srgb, ${fg} 14%, ${bg})`,
              `--card:color-mix(in srgb, ${fg} 4%, ${bg})`,
              `--card-foreground:${fg}`,
            ].join(';');
          },
        },
        div(
          { class: 'welcome-preview-fit' },
          div(
            { class: 'tabbar welcome-preview-terms' },
            ghost(icons.board),
            ghost(icons.explorer),
            div(
              { class: 'welcome-preview-tabs' },
              previewTab('in_progress', 'shop: npm run dev'),
              previewTab('completed', 'api: cargo test', true),
              previewTab('needs_input', 'claude'),
            ),
            ghost(icons.plus),
            ghost(icons.group),
            ghost(icons.settings, 'settings-btn'),
          ),
          div(
            { class: 'tabbar welcome-preview-boardbar' },
            ghost(icons.board, 'welcome-preview-board-icon'),
            ghost(icons.rows, 'welcome-preview-rows'),
            ghost(icons.listFilter, 'welcome-preview-filter'),
            ghost(icons.settings, 'settings-btn'),
          ),
          div(
            { class: 'welcome-preview-stage' },
            div(
              { class: () => `welcome-preview-board${selectedView() === 'list' ? ' list' : ''}` },
              previewColumn('backlog', 'Backlog', '0', true),
              previewColumn('in_progress', 'In progress', '1', true, shopCard, shopRow),
              previewColumn('needs_input', 'Needs input', '1', false, claudeCard, claudeRow),
              previewColumn('completed', 'Completed', '1', false, undefined, doneRow),
              previewColumn('archived', 'Archived', '0', false),
            ),
            div(
              { class: 'welcome-preview-drawer' },
              header(
                { class: 'drawer-bar' },
                ghost(icons.arrowRightToLine),
                ghost(icons.explorer),
                span({ class: 'drawer-title' }, 'api: cargo test'),
                span(
                  { class: 'drawer-move-label' },
                  i({ class: 'status-glyph', 'data-status': 'completed' }, glyph('completed')),
                  'Completed',
                  icons.chevronDown(),
                ),
                ghost(icons.expand),
              ),
              div({ class: 'welcome-preview-terminal' }, () => terminalFrame(typedPreview.val)),
            ),
          ),
        ),
      ),
    ),
  );
}

function choiceCard(opts: {
  label: string;
  detail: string;
  selected: () => boolean;
  preview?: HTMLElement;
  onclick: () => void;
}): HTMLElement {
  return button(
    {
      type: 'button',
      class: 'welcome-choice-card',
      'aria-pressed': () => String(opts.selected()),
      onclick: opts.onclick,
    },
    span({ class: 'welcome-choice-radio', 'aria-hidden': 'true' }),
    span(
      { class: 'welcome-choice-copy' },
      span({ class: 'welcome-choice-name' }, opts.label),
      span({ class: 'welcome-choice-detail' }, opts.detail),
    ),
    opts.preview ?? '',
  );
}

function scrollChoiceList(...children: HTMLElement[]): HTMLElement {
  const list = div({ class: 'welcome-choice-list welcome-scroll-list' }, ...children);
  let seen = false;
  const update = () => {
    if (!list.isConnected) {
      if (seen) observer.disconnect();
      return;
    }
    seen = true;
    const end = list.scrollHeight - list.clientHeight;
    list.classList.toggle('fade-top', list.scrollTop > 1);
    list.classList.toggle('fade-bottom', end > 1 && list.scrollTop < end - 1);
  };
  const observer = new ResizeObserver(update);
  observer.observe(list);
  list.addEventListener('scroll', update, { passive: true });
  return list;
}

function ThemeChoices(): HTMLElement {
  return div(
    { class: 'welcome-choice-panel' },
    scrollChoiceList(
      ...Object.entries(THEMES).map(([id, t]) =>
        choiceCard({
          label: t.name,
          detail: t.system
            ? 'Follows your system setting.'
            : t.light
              ? 'A light terminal palette.'
              : 'A dark terminal palette.',
          selected: () => chosenTheme.val === id,
          preview: span(
            { class: 'welcome-choice-swatch', 'aria-hidden': 'true' },
            ...themePreviewColors(id).map((color) => span({ style: `--swatch:${color}` })),
          ),
          onclick: () => {
            chosenTheme.val = id;
            saveSetting('theme', id);
          },
        }),
      ),
    ),
  );
}

function FontChoices(): HTMLElement {
  return div(
    { class: 'welcome-choice-panel' },
    scrollChoiceList(
      ...Object.entries(FONTS).map(([id, f]) =>
        choiceCard({
          label: f.name,
          detail: f.google ? 'Loaded for the terminal.' : 'Uses your system font stack.',
          selected: () => chosenFont.val === id,
          preview: span(
            {
              class: 'welcome-choice-sample',
              style: `--choice-font:${fontStack(f)}`,
              'aria-hidden': 'true',
            },
            'Aa',
          ),
          onclick: () => {
            chosenFont.val = id;
            saveSetting('font', id);
          },
        }),
      ),
    ),
  );
}

const SOUND_DETAILS: Record<string, string> = {
  'mx-black-pbt': 'A quiet linear press.',
  'mx-blue': 'A click on every key.',
  'holy-panda': 'A soft tactile bump.',
  'gateron-black-ink': 'A deep, muted press.',
  off: 'Silence.',
};

function SoundChoices(): HTMLElement {
  return div(
    { class: 'welcome-choice-panel' },
    div(
      { class: 'welcome-choice-list' },
      ...Object.entries(TYPING_SOUNDS).map(([id, name]) =>
        choiceCard({
          label: name,
          detail: SOUND_DETAILS[id] ?? '',
          selected: () => chosenSound.val === id,
          onclick: () => {
            chosenSound.val = id;
            saveSetting('typingSound', id);
            playTyping(id);
          },
        }),
      ),
    ),
  );
}

function AgentChoices(): HTMLElement {
  const copied = van.state(false);
  let copyTimer = 0;
  const copyPrompt = () => {
    navigator.clipboard.writeText(SETUP_PROMPT).then(
      () => {
        copied.val = true;
        window.clearTimeout(copyTimer);
        copyTimer = window.setTimeout(() => {
          copied.val = false;
        }, 1500);
      },
      () => {},
    );
  };
  return div(
    { class: 'welcome-choice-panel welcome-agent-panel' },
    div(
      { class: 'welcome-choice-list welcome-agent-list' },
      ...providers.val.map((name) => {
        const command = current.saved.providers.find((p) => p.name === name)?.command ?? '';
        return choiceCard({
          label: name,
          detail: command,
          selected: () => provider.val === name,
          preview: span({ class: 'welcome-choice-agent', 'aria-hidden': 'true' }, providerIcon(command)()),
          onclick: () => {
            provider.val = name;
            saveSetting('agentProvider', name);
          },
        });
      }),
    ),
    div({ class: 'welcome-or' }, 'Or copy to your coding agent'),
    pre(
      { class: 'welcome-prompt' },
      span({ class: 'welcome-prompt-mark' }, '>'),
      ` ${SETUP_PROMPT}  `,
      button(
        {
          type: 'button',
          class: 'welcome-prompt-copy',
          'aria-label': 'Copy setup prompt',
          onclick: copyPrompt,
        },
        () => (copied.val ? '[copied]' : '[copy]'),
      ),
    ),
  );
}

// The choice controls a screen carries, if any. A child binding must hand
// van a node every time (a first null is pruned and never revisited), so the
// screens without choices hold an empty, hidden row instead.
function IntroMessage(): HTMLElement {
  return section(
    { class: 'welcome-intro-message' },
    span({ class: 'welcome-intro-kicker' }, 'Why a browser tab?'),
    ul(
      { class: 'welcome-intro-list' },
      li(
        strong('Work already happens in tabs.'),
        ' Issues, pull requests, docs, chats, AI, and localhost apps are already in your browser.',
      ),
      li(
        strong('Keep the real thing open.'),
        ' Tabsh leaves GitHub as GitHub, Slack as Slack, and makes the shell one more tab beside them.',
      ),
      li(
        strong('Switch less, stay with the work.'),
        ' The terminal sits next to the thing it builds, so your train of thought has fewer places to fall off.',
      ),
    ),
  );
}

function choiceRow(): HTMLElement {
  switch (on().id) {
    case 'intro':
      return IntroMessage();
    case 'view':
      return ViewChoices();
    case 'theme':
      return ThemeChoices();
    case 'font':
      return FontChoices();
    case 'sound':
      return SoundChoices();
    case 'agents':
      return AgentChoices();
    default:
      return div({ style: 'display:none' });
  }
}

export function Welcome(): HTMLDialogElement {
  van.derive(() => {
    if (on().id !== 'sound') stopTyping();
  });
  return dialog(
    {
      id: 'welcome',
      'aria-label': 'Welcome',
      // A person expects Escape to dismiss a dialog; this one stays up.
      oncancel: (e: Event) => e.preventDefault(),
    },
    div(
      { class: 'welcome-page', 'data-layout': 'split', 'data-screen': () => on().id },
      div(
        { class: 'welcome-question' },
        h2(
          {
            class: 'welcome-title',
            // The font screen's title is the sample: it is drawn in the face
            // just chosen, and returns to the page face on every other screen.
            style: () => {
              if (on().id !== 'font') return '';
              const face = FONTS[chosenFont.val];
              return face ? `font-family:${fontStack(face)}` : '';
            },
          },
          () => on().title,
        ),
        p({ class: 'welcome-text' }, () => on().body),
      ),
      div({ class: 'welcome-visual' }, AppPreview()),
      div(
        { class: 'welcome-main' },
        div({ class: 'welcome-body' }, () => choiceRow()),
        footer(
          { class: 'welcome-foot' },
          // One dot per screen, the current one marked; a decorative indicator
          // (the title and body announce where in the tour someone is), rebuilt
          // per step as the mark comes and goes.
          () =>
            div(
              { class: 'welcome-dots', 'aria-hidden': 'true' },
              ...WELCOME_SCREENS.map((_, i) =>
                span({ class: 'welcome-dot', ...(step.val === i ? { 'aria-current': 'step' } : {}) }),
              ),
            ),
          div(
            { class: 'welcome-actions' },
            button(
              {
                type: 'button',
                class: 'btn',
                'data-variant': 'ghost',
                hidden: () => step.val === 0,
                onclick: () => (step.val = clampStep(step.val - 1)),
              },
              'Back',
            ),
            button(
              {
                type: 'button',
                class: 'btn',
                'data-variant': 'ghost',
                hidden: () => !on().skip,
                onclick: () => {
                  saveSetting('welcomeSeen', dismissWelcome().welcomeSeen);
                  closeWelcome();
                },
              },
              'Skip',
            ),
            button(
              {
                type: 'button',
                class: 'btn',
                // showModal() would put the first focus on Skip (Back is hidden
                // at step 0), and an accidental Enter there ends the tour for
                // good: focus lands on the safe button instead.
                autofocus: true,
                // Finish onboarding ends the tour without dealing with the
                // board: its setup screen still waits. Until then clampStep
                // keeps the tour on the screen.
                onclick: () => {
                  if (on().setup) {
                    saveSettings(dismissWelcome());
                    closeWelcome();
                    return;
                  }
                  step.val = clampStep(step.val + 1);
                },
              },
              () => (on().setup ? 'Finish onboarding' : 'Continue'),
            ),
          ),
        ),
      ),
    ),
  );
}

// Opens the tour on its first screen; held off while the gate is up — the
// connection comes first.
export function showWelcome(): void {
  if (gateMode.val !== null) return;
  // The palette is a modal too, so it goes first — opening the tour over it
  // would throw. Its close listener walks the place back, exactly as Esc does.
  const palette = document.getElementById('palette') as HTMLDialogElement | null;
  if (palette?.open) palette.close();
  step.val = 0;
  pickedView.val = null;
  const names = current.saved.providers.map((p) => p.name);
  providers.val = names;
  // The dropdown starts on the provider New card offers first.
  provider.val = names.includes(current.saved.agentProvider) ? current.saved.agentProvider : (names[0] ?? '');
  chosenTheme.val = current.saved.theme;
  chosenFont.val = current.saved.font;
  chosenSound.val = null;
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
