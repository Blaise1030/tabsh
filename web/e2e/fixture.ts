// The e2e fixtures: a daemon per worker, plus the helpers every spec uses.
// The conventions (selectors, typing, auth) live in web/e2e/README.md.
import { execFileSync } from 'node:child_process';
import { closeSync, mkdirSync, mkdtempSync, openSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test as base, expect, type Page } from '@playwright/test';
import { startDaemon, type Daemon } from './daemon.ts';
import { installTerminalSpy } from './term.ts';

// One daemon — its own port and its own empty state dir — per worker, so
// specs never see each other's tabs. Tests within a worker run one at a time.
// (The second generic types worker-scoped fixtures; tests still get `daemon`.)
const test = base.extend<
  { project: string; crowd: string; twins: { alpha: string; beta: string }; terminalSpy: void },
  { daemon: Daemon }
>({
  // Record every xterm the page opens so termText() can read its buffer.
  // Auto: every spec gets it, even ones that only use tabs.
  terminalSpy: [
    async ({ page }, use) => {
      await page.addInitScript(installTerminalSpy);
      await use();
    },
    { auto: true },
  ],
  // A git project for the file explorer: a README, `src/main.rs`, an ignored
  // `target/`, an empty `docs/`, a dotfile, a file whose name is markup, and one whose name has a space
  // and a quote.
  // The path is the real one (the tmp dir is a symlink on macOS).
  project: async ({}, use) => {
    const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'tabsh-project-')));
    execFileSync('git', ['init', '-q'], { cwd: dir });
    mkdirSync(path.join(dir, 'src'));
    mkdirSync(path.join(dir, 'target'));
    mkdirSync(path.join(dir, 'docs'));
    writeFileSync(path.join(dir, 'README.md'), '# project\n');
    writeFileSync(path.join(dir, 'src/main.rs'), 'fn main() {}\n');
    writeFileSync(path.join(dir, '.gitignore'), 'target/\n');
    writeFileSync(path.join(dir, 'target/junk.txt'), 'junk\n');
    writeFileSync(path.join(dir, '.env.example'), 'A=1\n');
    writeFileSync(path.join(dir, "my file's notes.md"), 'notes\n');
    writeFileSync(path.join(dir, '<img src=x onerror=alert(1)>.txt'), 'x\n');
    await use(dir);
    rmSync(dir, { recursive: true, force: true });
  },
  // Two git projects side by side, for a tab that moves between them: `alpha`
  // holds `alpha.md`; `beta` holds `beta.md` and `docs/guide.md`.
  twins: async ({}, use) => {
    const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'tabsh-twins-')));
    const make = (name: string, files: Record<string, string>) => {
      const root = path.join(dir, name);
      mkdirSync(root);
      execFileSync('git', ['init', '-q'], { cwd: root });
      for (const [file, text] of Object.entries(files)) {
        mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
        writeFileSync(path.join(root, file), text);
      }
      return root;
    };
    const alpha = make('alpha', { 'alpha.md': '# alpha\n' });
    const beta = make('beta', { 'beta.md': '# beta\n', 'docs/guide.md': '# guide\n' });
    await use({ alpha, beta });
    rmSync(dir, { recursive: true, force: true });
  },
  // A directory outside any repo with more files than the explorer lists.
  crowd: async ({}, use) => {
    const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'tabsh-crowd-')));
    for (let i = 0; i <= 20_000; i++) closeSync(openSync(path.join(dir, `f${i}`), 'w'));
    await use(dir);
    rmSync(dir, { recursive: true, force: true });
  },
  daemon: [
    async ({}, use) => {
      const daemon = await startDaemon();
      await use(daemon);
      await daemon.cleanup();
    },
    { scope: 'worker' },
  ],
});

export { test, expect };

// Pair the page with the daemon and wait for the app: the token rides in the
// URL fragment, exactly as in the link the daemon prints, and the page clears
// it from the address bar before talking to the API.
// On a phone (`phone: true`) the app opens on the board, its first terminal in the drawer.
export async function openApp(page: Page, daemon: Daemon, { phone = false } = {}): Promise<void> {
  // The daemon outlives a spec, and so do its saved `explorerOpen` and
  // `welcomeSeen`: a spec that closes the sidebar as it ends may be torn down
  // before that save lands, and one that leaves the tour unseen would meet
  // the welcome dialog instead of the app. Start every spec with the sidebar
  // closed and the tour seen, so a click opens the sidebar.
  const headers = { Authorization: `Bearer ${daemon.token}` };
  const now = await (await page.request.get(`${daemon.baseUrl}/api/settings`, { headers })).json();
  if (now.explorerOpen || now.welcomeSeen !== true) {
    const put = await page.request.put(`${daemon.baseUrl}/api/settings`, {
      headers,
      data: { ...now, explorerOpen: false, welcomeSeen: true },
    });
    expect(put.status()).toBe(204);
  }
  await page.goto(`${daemon.baseUrl}/app/#token=${daemon.token}`);
  if (phone) {
    await expect(page.locator('#frame.in-drawer .term.active .xterm-screen')).toBeVisible();
    return;
  }
  await expect(page.locator('#tabs')).toBeVisible();
  // A fresh daemon has no sessions, so the app opens its first terminal by
  // itself once paired (main.ts). Waiting for it means the page is settled:
  // newTab's count math starts from a known place.
  await expect(page.locator('#tabs .tab').first()).toBeVisible();
}

// Close every session, so a spec starts on a fresh shell, not one an earlier
// spec left mid-command on the shared daemon.
export async function dropSessions(page: Page, daemon: Daemon): Promise<void> {
  const headers = { Authorization: `Bearer ${daemon.token}` };
  const list = await page.request.get(`${daemon.baseUrl}/api/sessions`, { headers });
  for (const s of (await list.json()) as { id: string }[]) {
    await page.request.delete(`${daemon.baseUrl}/api/sessions/${s.id}`, { headers });
  }
}

// Click "new terminal" and wait for the tab strip and the terminal itself;
// the shell's prompt arrives over the socket a moment later.
// The app opens its first terminal by itself (main.ts); this clicks "new
// terminal" and waits for one MORE tab, so the helper stays honest however
// many tabs are already open.
export async function newTab(page: Page): Promise<void> {
  const tabs = page.locator('#tabs .tab:not(.mirror)');
  const before = await tabs.count();
  // Scoped to the tabbar: the empty state has a second new-terminal button.
  await page.locator('.tabbar [data-new-session]').click();
  await expect(tabs).toHaveCount(before + 1);
  await expect(page.locator('.term.active')).toBeVisible();
}

// Focus a terminal and type. Clicking the terminal focuses xterm's hidden
// textarea; page.keyboard then sends real key events through the page, the
// socket and the PTY.
export async function typeInTerminal(page: Page, text: string): Promise<void> {
  await page.locator('.term.active').click();
  await page.keyboard.type(text);
}

// Make the active tab's shell `cd` somewhere, and wait until it has: the
// command renames the tab (OSC 0) once the `cd` is done, the one DOM effect
// of shell output. `mark` must differ from the tab's current name.
export async function cdInTerminal(page: Page, dir: string, mark: string): Promise<void> {
  await expect(async () => {
    await typeInTerminal(page, '\u0003');
    await typeInTerminal(page, `cd '${dir}' && printf '\\033]0;${mark}\\007'`);
    await page.keyboard.press('Enter');
    await expect(page.locator('#tabs .tab:not(.mirror)[aria-selected="true"] span')).toHaveText(mark, { timeout: 2_000 });
  }).toPass({ timeout: 10_000 });
}

// Agent providers for specs, each named by its command, so the real agents
// never start.
export const TEST_PROVIDERS = ['true', 'touch launched', 'touch dragged'].map((command) => ({
  name: command,
  command,
  resume: '',
}));

// Sets the stored `boardOnboarded` flag and the test providers, keeping the
// other settings.
// Back to the terminals from the board: the Board button steps through the
// board as columns, then as a list, then the terminals.
export async function leaveBoard(page: Page): Promise<void> {
  const board = page.locator('#board');
  if (!(await board.evaluate((b) => b.classList.contains('list')))) await page.locator('#board-btn').click();
  await expect(board).toHaveClass(/\blist\b/);
  await page.locator('#board-btn').click();
  await expect(board).toBeHidden();
}

export async function setOnboarded(page: Page, daemon: Daemon, on: boolean): Promise<void> {
  const headers = { Authorization: `Bearer ${daemon.token}` };
  const now = await (await page.request.get(`${daemon.baseUrl}/api/settings`, { headers })).json();
  const res = await page.request.put(`${daemon.baseUrl}/api/settings`, {
    headers,
    data: { ...now, boardOnboarded: on, providers: TEST_PROVIDERS },
  });
  expect(res.status()).toBe(204);
}
