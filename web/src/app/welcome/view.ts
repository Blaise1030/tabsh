// The welcome tour's dialog: one full-page screen per WELCOME_SCREENS entry,
// opened on first load (initWelcome) and again from the palette's Show
// welcome, walked with Continue, left with Skip.
// The view, theme, font and sound screens carry their choices; the agents
// screen picks a provider, and its Set up opens that provider's setup card.
import van, { type State } from 'vanjs-core';
import type { Status } from '../board/model.ts';
import { setStatus } from '../board/status.ts';
import { openSetupCard } from '../board/view.ts';
import { gateMode } from '../daemon/client.ts';
import { go } from '../nav/router.ts';
import { FONTS, fontStack, THEMES, TYPING_SOUNDS } from '../settings/catalog.ts';
import { current, saveSetting, saveSettings } from '../settings/settings.ts';
import { previewSound } from '../sound/packs.ts';
import { glyph, type Icon, icons, providerIcon } from '../ui/icons.ts';
import { keyed } from '../ui/keyed.ts';
import {
  agentSetupPatch,
  clampStep,
  closesAfterSetup,
  dismissWelcome,
  viewChoice,
  viewSettings,
  WELCOME_SCREENS,
} from './steps.ts';

const { button, dialog, div, footer, h2, i, p, span } = van.tags;

// Which screen is on show; showWelcome resets it.
const step = van.state(0);
// The view picked on this opening, null until one is: its being set is also
// what makes closing move the app there.
const pickedView = van.state<'tabs' | 'kanban' | 'list' | null>(null);
// The agents screen's dropdown: the provider names it offers, the chosen one,
// and whether its setup card is on its way (Set up, Back and Continue wait).
const providers: State<string[]> = van.state([]);
const provider: State<string> = van.state('');
const busy: State<boolean> = van.state(false);
const chosenTheme: State<string> = van.state(current.saved.theme);
const chosenFont: State<string> = van.state(current.saved.font);

const on = () => WELCOME_SCREENS[step.val];
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

function ViewChip(kind: 'tabs' | 'kanban' | 'list'): HTMLElement {
  return span({ class: 'welcome-view-chip', 'data-kind': kind, 'aria-hidden': 'true' }, VIEW_NAMES[kind].slice(0, 1));
}

function ViewChoices(): HTMLElement {
  return div(
    { class: 'welcome-choice-panel' },
    AppPreview(),
    div(
      { class: 'welcome-choice-list welcome-view-list' },
      ...(['tabs', 'kanban', 'list'] as const).map((choice) =>
        choiceCard({
          label: VIEW_NAMES[choice],
          detail: VIEW_DETAILS[choice],
          selected: () => selectedView() === choice,
          preview: ViewChip(choice),
          onclick: () => pickView(choice),
        }),
      ),
    ),
  );
}

// The theme and font screens use full-width choice cards; sound stays a
// compact row because it is an immediate preview control.
const rowStyle = 'display:flex; flex-wrap:wrap; gap:.375rem;';

const themePreviewColors = (id: string): string[] => {
  const c = THEMES[id].colors;
  return [c.background, c.foreground, c.blue, c.green, c.yellow, c.red, c.magenta, c.cyan];
};

const mark = (status: Status, className: string) => i({ class: className, 'data-status': status }, glyph(status));

function previewTab(status: Status, name: string, active = false): HTMLElement {
  return span(
    { class: active ? 'welcome-preview-tab active' : 'welcome-preview-tab' },
    mark(status, 'tab-status'),
    span({ class: 'name' }, name),
    active ? span({ class: 'x' }, icons.close()) : '',
  );
}

function previewCard(opts: {
  status: Status;
  title: string;
  path: string;
  time: string;
  note?: string;
  agent?: Icon;
}): HTMLElement {
  return div(
    { class: 'welcome-preview-card' },
    div(
      { class: 'top' },
      span({ class: 'title' }, opts.title),
      mark(opts.status, 'status-glyph'),
      span({ class: 'more' }, icons.more()),
    ),
    div({ class: 'meta' }, icons.folder(), span(opts.path)),
    opts.note ? div({ class: 'note' }, opts.note) : '',
    div({ class: 'meta time' }, opts.agent ? span({ class: 'agent' }, opts.agent()) : '', span(opts.time)),
  );
}

function previewCol(status: Status, name: string, count: string, plus: boolean, card: HTMLElement): HTMLElement {
  return div(
    { class: 'welcome-preview-col' },
    div(
      { class: 'head' },
      mark(status, 'status-glyph'),
      span({ class: 'name' }, name),
      span({ class: 'count' }, count),
      plus ? span({ class: 'plus' }, icons.plus()) : '',
    ),
    card,
  );
}

function previewRow(opts: {
  status: Status;
  title: string;
  path: string;
  time: string;
  note?: string;
  agent?: Icon;
}): HTMLElement {
  return div(
    { class: 'welcome-preview-row' },
    mark(opts.status, 'status-glyph'),
    span({ class: 'title' }, opts.title),
    opts.note ? span({ class: 'note' }, opts.note) : '',
    span(
      { class: 'end' },
      span({ class: 'meta' }, icons.folder(), span(opts.path)),
      opts.agent ? span({ class: 'agent' }, opts.agent()) : '',
      span({ class: 'time' }, opts.time),
      span({ class: 'more' }, icons.more()),
    ),
  );
}

function previewGroup(status: Status, name: string, count: string, plus: boolean, row?: HTMLElement): HTMLElement {
  return div(
    { class: 'welcome-preview-group' },
    div(
      { class: 'head' },
      span({ class: 'chev' }, icons.chevronDown()),
      mark(status, 'status-glyph'),
      span({ class: 'name' }, name),
      span({ class: 'count' }, count),
      plus ? span({ class: 'plus' }, icons.plus()) : '',
    ),
    row ?? '',
  );
}

function PreviewTerminal(): HTMLElement {
  const ok = (text: string) => span({ class: 'ok' }, text);
  const prompt = (cmd: string) =>
    div(
      span({ class: 'path' }, '~/code/api '),
      span({ class: 'prompt' }, '❯'),
      cmd ? ` ${cmd}` : ' ',
      cmd ? '' : span({ class: 'cursor' }),
    );
  return div(
    { class: 'welcome-preview-terminal' },
    prompt('cargo test'),
    div(ok('Compiling'), ' api v0.4.1 (~/code/api)'),
    div(ok(' Finished'), ' `test` profile [unoptimized + debuginfo] in 3.42s'),
    div(ok('  Running'), ' unittests src/lib.rs'),
    div({ class: 'gap' }),
    div('running 48 tests'),
    div('test auth::login ... ', ok('ok')),
    div('test auth::refresh_token ... ', ok('ok')),
    div('test cart::add_item ... ', ok('ok')),
    div('test orders::refund ... ', ok('ok')),
    div({ class: 'gap' }),
    div('test result: ', ok('ok'), '. 48 passed; 0 failed; finished in 0.81s'),
    div({ class: 'gap' }),
    prompt(''),
  );
}

function AppPreview(): HTMLElement {
  const shop = { status: 'in_progress' as const, title: 'shop: npm run dev', path: '~/code/shop' };
  const claude = {
    status: 'needs_input' as const,
    title: 'claude',
    path: '~/code/shop',
    note: 'Run the tests before I commit?',
    agent: icons.claude,
  };
  return div(
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
          `--preview-bg:${bg}`,
          `--preview-fg:${fg}`,
          `--preview-accent:${c.green}`,
          `--preview-blue:${c.blue}`,
          `--preview-font:${fontStack(f)}`,
          `--background:${bg}`,
          `--foreground:${fg}`,
          `--muted:color-mix(in srgb, ${fg} 8%, ${bg})`,
          `--muted-foreground:color-mix(in srgb, ${fg} 60%, ${bg})`,
          `--border:color-mix(in srgb, ${fg} 14%, ${bg})`,
          `--card:color-mix(in srgb, ${fg} 4%, ${bg})`,
        ].join(';');
      },
    },
    div(
      { class: 'welcome-preview-tabbar' },
      span({ class: 'welcome-preview-ico welcome-preview-board-icon' }, icons.board()),
      span({ class: 'welcome-preview-ico welcome-preview-rows-icon' }, icons.rows()),
      span({ class: 'welcome-preview-ico welcome-preview-explorer' }, icons.explorer()),
      span(
        { class: 'welcome-preview-tabs' },
        previewTab('in_progress', 'shop: npm run dev'),
        previewTab('completed', 'api: cargo test', true),
        previewTab('needs_input', 'claude'),
      ),
      span({ class: 'welcome-preview-ico welcome-preview-plus' }, icons.plus()),
      span({ class: 'welcome-preview-spacer' }),
      span({ class: 'welcome-preview-ico welcome-preview-group-btn' }, icons.group()),
      span({ class: 'welcome-preview-ico welcome-preview-filter' }, icons.listFilter()),
      span({ class: 'welcome-preview-ico' }, icons.settings()),
    ),
    div(
      { class: 'welcome-app-preview-stage' },
      div(
        { class: 'welcome-preview-board' },
        div(
          { class: 'welcome-preview-kanban' },
          previewCol('in_progress', 'In progress', '1', true, previewCard({ ...shop, time: '2m' })),
          previewCol('needs_input', 'Needs input', '1', false, previewCard({ ...claude, time: '4m' })),
        ),
        div(
          { class: 'welcome-preview-list' },
          previewGroup('backlog', 'Backlog', '0', true),
          previewGroup('in_progress', 'In progress', '1', true, previewRow({ ...shop, time: '3m' })),
          previewGroup('needs_input', 'Needs input', '1', false, previewRow({ ...claude, time: '5m' })),
          previewGroup(
            'completed',
            'Completed',
            '1',
            false,
            previewRow({ status: 'completed', title: 'api: cargo test', path: '~/code/api', time: '4m' }),
          ),
          previewGroup('archived', 'Archived', '0', false),
        ),
      ),
      div(
        { class: 'welcome-preview-drawer' },
        div(
          { class: 'welcome-preview-drawerbar' },
          span({ class: 'welcome-preview-ico' }, icons.arrowRightToLine()),
          span({ class: 'welcome-preview-ico' }, icons.explorer()),
          span({ class: 'title' }, 'api: cargo test'),
          span({ class: 'move' }, mark('completed', 'status-glyph'), 'Completed', icons.chevronDown()),
          span({ class: 'welcome-preview-ico' }, icons.expand()),
        ),
        PreviewTerminal(),
      ),
    ),
  );
}

function choiceCard(opts: {
  label: string;
  detail: string;
  selected: () => boolean;
  preview: HTMLElement;
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
    opts.preview,
  );
}

function ThemeChoices(): HTMLElement {
  return div(
    { class: 'welcome-choice-panel' },
    AppPreview(),
    div(
      { class: 'welcome-choice-list' },
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
    AppPreview(),
    div(
      { class: 'welcome-choice-list' },
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

function SoundChoices(): HTMLElement {
  return div(
    { style: rowStyle },
    ...Object.entries(TYPING_SOUNDS).map(([id, name]) =>
      button(
        {
          type: 'button',
          class: 'btn',
          'data-variant': 'outline',
          'data-size': 'sm',
          onclick: () => {
            saveSetting('typingSound', id);
            previewSound(id);
          },
        },
        name,
      ),
    ),
  );
}

// A provider's drawing: its icon, then its name.
const providerFace = (name: string): (Node | string)[] => [
  providerIcon(current.saved.providers.find((p) => p.name === name)?.command ?? '')(),
  span({ class: 'nc-value' }, name || 'Agent'),
];

// The agents screen's provider control, as Basecoat's dropdown (its script
// opens and closes it, and moves through it by keyboard), the same
// menuitemradio pattern as the New card dialog's chips: the button shows the
// chosen name and a chevron, the menu lists the providers, the current one
// checked.
function ProviderMenu(): HTMLElement {
  const row = (name: string) =>
    div(
      {
        role: 'menuitemradio',
        'aria-checked': () => String(provider.val === name),
        onclick: () => {
          provider.val = name;
        },
      },
      ...providerFace(name),
      () => (provider.val === name ? icons.check() : span()),
    );
  const menu = div({ role: 'menu', 'aria-label': 'Agent' });
  keyed(
    menu,
    () => providers.val,
    (name) => name,
    row,
  );
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
        'aria-label': 'Agent',
        'aria-haspopup': 'menu',
        'aria-expanded': 'false',
      },
      () => span({ class: 'nc-trigger-body' }, ...providerFace(provider.val), icons.chevronDown()),
    ),
    div({ 'data-popover': '', 'aria-hidden': 'true' }, menu),
  );
}

// The agents screen's Set up: opens the chosen provider's setup card, and
// only then — `closesAfterSetup` — saves the patch that ends the tour and
// deals with the board in one write, starts the card's agent, and closes.
// A card that didn't open leaves the dialog on Agents, nothing saved.
async function setUpAgent(): Promise<void> {
  if (busy.val) return;
  const chosen = current.saved.providers.find((p) => p.name === provider.val) ?? current.saved.providers[0];
  if (!chosen) return;
  // The pick that moved this opening to the board keeps it there: the card
  // opens without taking focus. Otherwise it is the tab to look at.
  const toBoard = pickedView.val !== null && current.saved.startView === 'board';
  busy.val = true;
  const s = await openSetupCard({ command: chosen.command, resume: chosen.resume, focus: !toBoard });
  if (!closesAfterSetup(s !== null) || s === null) {
    busy.val = false;
    return;
  }
  saveSettings(agentSetupPatch(chosen.name));
  await setStatus(s, 'in_progress').catch(console.error); // starts its agent
  closeWelcome();
}

function AgentChoices(): HTMLElement {
  return div(
    { style: 'display:flex; gap:.5rem; align-items:center;' },
    ProviderMenu(),
    button(
      {
        type: 'button',
        class: 'btn',
        'data-variant': 'outline',
        'data-size': 'sm',
        disabled: () => busy.val,
        onclick: () => void setUpAgent(),
      },
      'Set up',
    ),
  );
}

// The choice controls a screen carries, if any. A child binding must hand
// van a node every time (a first null is pruned and never revisited), so the
// screens without choices hold an empty, hidden row instead.
function choiceRow(): HTMLElement {
  switch (on().id) {
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
  return dialog(
    {
      id: 'welcome',
      'aria-label': 'Welcome',
      // A person expects Escape to dismiss a dialog; this one stays up.
      oncancel: (e: Event) => e.preventDefault(),
    },
    div(
      { class: 'welcome-page' },
      div(
        { class: 'welcome-body' },
        h2({ class: 'welcome-title' }, () => on().title),
        p({ class: 'welcome-text' }, () => on().body),
        () => choiceRow(),
      ),
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
              hidden: () => step.val === 0 || !on().skip,
              disabled: () => busy.val,
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
              disabled: () => busy.val,
              // The agents screen's Continue ends the tour without dealing
              // with the board: its setup screen still waits. Until then
              // clampStep keeps the tour on the screen.
              onclick: () => {
                if (on().setup) {
                  saveSettings(dismissWelcome());
                  closeWelcome();
                  return;
                }
                step.val = clampStep(step.val + 1);
              },
            },
            'Continue',
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
  busy.val = false;
  const names = current.saved.providers.map((p) => p.name);
  providers.val = names;
  // The dropdown starts on the provider New card offers first.
  provider.val = names.includes(current.saved.agentProvider) ? current.saved.agentProvider : (names[0] ?? '');
  chosenTheme.val = current.saved.theme;
  chosenFont.val = current.saved.font;
  el().showModal();
}

// Called once the daemon has answered and the settings are in: the tour is
// for someone tabsh hasn't met yet.
export function initWelcome(): void {
  if (!current.saved.welcomeSeen) showWelcome();
}
