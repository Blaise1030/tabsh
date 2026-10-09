// Markdown comments, end to end: the preview's frame runs only tabsh's
// script; a comment pastes into the tab's terminal; comments outlive a
// re-render, and stay with their tab.
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { cdInTerminal, expect, newTab, openApp, pickTheme, test, typeInTerminal } from './fixture.ts';

const shown = (page: Page) => page.locator('#pane .pane-view:not([hidden])');

// The daemon is shared by the worker's specs, and the sidebar's state and the
// theme are saved settings: leave them as they were (the explorer specs toggle
// the sidebar; the palette spec expects the theme it started with).
let themeBefore = '';
const settingsUrl = (daemon: { baseUrl: string }) => `${daemon.baseUrl}/api/settings`;
const auth = (daemon: { token: string }) => ({ Authorization: `Bearer ${daemon.token}` });
test.beforeEach(async ({ page, daemon }) => {
  themeBefore = (await (await page.request.get(settingsUrl(daemon), { headers: auth(daemon) })).json()).theme;
});
test.afterEach(async ({ page, daemon }) => {
  if ((await page.locator('#explorer-btn').getAttribute('aria-pressed')) === 'true') {
    const saved = page.waitForResponse((r) => r.url().includes('/api/settings') && r.request().method() === 'PUT');
    await page.locator('#explorer-btn').click();
    await saved;
  }
  const now = await (await page.request.get(settingsUrl(daemon), { headers: auth(daemon) })).json();
  if (now.theme !== themeBefore) {
    const put = await page.request.put(settingsUrl(daemon), {
      headers: auth(daemon),
      data: { ...now, theme: themeBefore },
    });
    expect(put.status()).toBe(204);
  }
});
const preview = (page: Page) => shown(page).frameLocator('.pane-frame');

// Opens `name`, in `project`, from the explorer in the active tab. `cd:
// false` when the tab is already in `project` (a second `cd` can race the first's title).
async function openFile(page: Page, project: string, name: string, { cd = true } = {}): Promise<void> {
  if (cd) await cdInTerminal(page, project, `in-${name}`);
  if ((await page.locator('#explorer-btn').getAttribute('aria-pressed')) !== 'true') {
    await page.locator('#explorer-btn').click();
  }
  await page.locator('#explorer').getByRole('treeitem', { name, exact: true }).click();
  await expect(shown(page).locator('.pane-head')).toContainText(name);
  await expect(shown(page).locator('.pane-frame')).toHaveCount(1);
}

const rows = (page: Page) => page.locator('.term.active .xterm-rows');
const status = (page: Page) => shown(page).locator('.pane-status');
const highlights = (page: Page) =>
  preview(page)
    .locator('body')
    .evaluate(() => CSS.highlights.get('tabsh-comment')?.size ?? 0);

// Selects the whole text of the `nth` element in the preview holding `text`,
// then lets the frame script see the mouseup that ends a drag. The frame's
// script may not be listening yet, so it selects again until the Comment
// button shows.
async function select(page: Page, text: string, nth = 0): Promise<void> {
  await expect(async () => {
    await preview(page)
      .getByText(text)
      .nth(nth)
      .evaluate((el) => {
        const range = new Range(); // not document.createRange: a page can shadow it
        range.selectNodeContents(el);
        const sel = getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      });
    await expect(shown(page).locator('.comment-menu')).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 10_000 });
}

// Comments `note` on the `nth` element holding `text`.
async function comment(page: Page, text: string, note: string, nth = 0): Promise<void> {
  await select(page, text, nth);
  await shown(page).locator('.comment-menu [role="menuitem"]').click();
  await shown(page).locator('.comment-box textarea').fill(note);
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(shown(page).locator('.comment-box')).toBeHidden();
}

// Blanks the active terminal's screen and scrollback: the daemon, and so the
// terminal, outlives each test, and earlier tests' output must not satisfy this one's.
async function clearTerminal(page: Page): Promise<void> {
  await typeInTerminal(page, "printf '\\033[H\\033[2J\\033[3J'; echo clear-$((40+2))");
  await page.keyboard.press('Enter');
  await expect(rows(page)).toContainText('clear-42');
  await expect(rows(page)).not.toContainText('for me:');
}

// Runs `cat` in the active terminal with bracketed paste on or off, so a paste
// shows as cat's echo and nothing runs it. Waits until cat is running.
async function catWithPasteMode(page: Page, on: boolean): Promise<void> {
  await clearTerminal(page);
  await typeInTerminal(page, `printf '\\033[?2004${on ? 'h' : 'l'}'; echo cat-$((40+2)); cat`);
  await page.keyboard.press('Enter');
  await expect(rows(page)).toContainText('cat-42');
}

// Points at the middle of the first element in the preview holding `text`.
async function hover(page: Page, text: string): Promise<void> {
  // The frame has drawn the highlight (it answers the pane's `keep` a moment after the save).
  await expect.poll(() => highlights(page)).toBeGreaterThan(0);
  const box = await preview(page).getByText(text).first().boundingBox();
  if (!box) throw new Error(`no box for ${text}`);
  await page.mouse.move(box.x + Math.min(20, box.width / 2), box.y + box.height / 2);
}

const PLAN = '# Plan\n\nFirst paragraph.\n\nSecond paragraph\nspans two lines.\n';

// Switches the pane to the source view and back to the preview, by its button.
async function roundTrip(page: Page): Promise<void> {
  const toggle = () => shown(page).locator('.pane-head button[title^="Edit"], .pane-head button[title^="Preview"]');
  await toggle().click();
  await expect(shown(page).locator('.cm-editor')).toBeVisible();
  await toggle().click();
  await expect(shown(page).locator('.pane-frame')).toHaveCount(1);
}

test("a Markdown preview runs tabsh's frame script and nothing from the file", async ({ page, daemon, project }) => {
  await openApp(page, daemon);
  // Other scripts the page's CSP would let a frame reach: this app's entry
  // module, a CDN, and a second copy of tabsh's frame script with a forged
  // mark (its URL is read off a first preview's document).
  const entry = await page.locator('script[type="module"]').first().getAttribute('src');
  expect(entry).toMatch(/^\/_astro\//);
  writeFileSync(path.join(project, 'probe.md'), '# Probe\n');
  await openFile(page, project, 'probe.md');
  const probe = (await shown(page).locator('.pane-frame').getAttribute('srcdoc')) ?? '';
  const own = /<script src="([^"]+preview-frame-[^"]+)"><\/script>/.exec(probe)?.[1] ?? '';
  expect(own).toMatch(/[?&]m=[0-9a-f]{32}/);
  const forged = own.replace(/m=[0-9a-f]{32}/, `m=${'a'.repeat(32)}`);
  expect(forged).not.toBe(own);
  writeFileSync(
    path.join(project, 'hostile.md'),
    [
      '# Hostile',
      '',
      'Plain text stays.',
      '',
      '<script>document.body.dataset.inline = "ran"</script>',
      '',
      '<script type="module">document.body.dataset.module = "ran"</script>',
      '',
      '<img src="x" onerror="document.body.dataset.handler = \'ran\'">',
      '',
      '<script src="data:text/javascript,document.body.dataset.data=%22ran%22"></script>',
      '',
      `<script type="module" src="${entry}"></script>`,
      '',
      `<script src="${forged}"></script>`,
      '',
      '<script src="https://cdn.jsdelivr.net/npm/left-pad@1.3.0/index.js"></script>',
      '',
    ].join('\n'),
  );
  const answered: string[] = [];
  const failures: [string, string | undefined][] = [];
  page.on('response', (r) => answered.push(r.url()));
  page.on('requestfailed', (r) => failures.push([r.url(), r.failure()?.errorText]));
  await page.evaluate(() => {
    (window as any).__readyCount = 0;
    addEventListener('message', (e) => {
      if (e.data?.type === 'ready') (window as any).__readyCount++;
    });
  });
  await openFile(page, project, 'hostile.md', { cd: false });
  const frame = shown(page).locator('.pane-frame');
  await expect(frame).toHaveAttribute('sandbox', 'allow-scripts');
  await expect(frame).toHaveAttribute(
    'srcdoc',
    /^<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src http:\/\/[^/" ]+\/_astro\/preview-frame-[\w-]+\.js; style-src 'unsafe-inline'; img-src data: blob:">/,
  );
  // The handlers and the foreign scripts have had their chance.
  await page.waitForTimeout(1000);
  const body = preview(page).locator('body');
  await expect(body).toContainText('Plain text stays.');
  for (const name of ['inline', 'module', 'handler', 'data']) {
    expect(await body.getAttribute(`data-${name}`)).toBeNull();
  }
  expect(await body.evaluate((el) => Object.keys((el as HTMLElement).dataset))).toEqual([]);
  // The CSP refuses the entry module and the CDN: playwright sees the attempt,
  // but it fails as 'csp' and nothing ever answers it.
  const foreign = (u: string) => u.includes(entry as string) || u.includes('cdn.jsdelivr.net');
  expect(answered.filter(foreign)).toEqual([]);
  expect(failures.filter(([u]) => foreign(u)).every(([, why]) => why === 'csp')).toBe(true);
  // Only tabsh's own script announced itself; the forged-mark copy never ran.
  expect(await page.evaluate(() => (window as any).__readyCount)).toBe(1);
});

test('a theme change re-themes a Markdown preview in place', async ({ page, daemon, project }) => {
  writeFileSync(path.join(project, 'themed.md'), '# Themed\n\nSome text.\n');
  await openApp(page, daemon);
  await openFile(page, project, 'themed.md');
  const frame = shown(page).locator('.pane-frame');
  await expect(preview(page).locator('body')).toContainText('Some text.');
  const srcdoc = await frame.getAttribute('srcdoc');
  const style = preview(page).locator('#tabsh-theme');
  await pickTheme(page, 'Nord');
  const nord = await style.textContent();
  await pickTheme(page, 'Dracula');
  await expect(style).not.toHaveText(nord ?? '');
  // tabsh's frame script took the theme: the document was never replaced.
  await expect(frame).toHaveAttribute('srcdoc', srcdoc ?? '');
  await expect(frame).toHaveCount(1);
});

test("a refresh in the Markdown can't load another page into the preview", async ({ page, daemon, project }) => {
  writeFileSync(
    path.join(project, 'refresh.md'),
    '# Refresh\n\n<meta http-equiv="refresh" content="0;url=data:text/html,moved">\n',
  );
  await openApp(page, daemon);
  await openFile(page, project, 'refresh.md');
  // The refresh's 0 s has had its chance; the page's frame-src (blob: only) refuses it.
  await page.waitForTimeout(1000);
  for (const frame of page.frames()) {
    expect(frame.url().startsWith('data:'), frame.url()).toBe(false);
    if (frame !== page.mainFrame()) {
      expect(await frame.locator('body').textContent().catch(() => '')).not.toContain('moved');
    }
  }
});

test('a form control named like a DOM property cannot hang or break the frame script', async ({
  page,
  daemon,
  project,
}) => {
  writeFileSync(
    path.join(project, 'clobber.md'),
    [
      '# Clobber',
      '',
      '<form><input name="parentElement">trap text</form>',
      '',
      '<form id="F"></form>',
      '',
      'Plain words <input name="parentElement" form="F"> here.',
      '',
      '<img name="querySelectorAll"><img name="createTreeWalker"><img name="createRange">',
      '',
    ].join('\n'),
  );
  await openApp(page, daemon);
  await openFile(page, project, 'clobber.md');
  await expect(preview(page).locator('body')).toContainText('trap text');
  await preview(page)
    .getByText('trap text')
    .evaluate((el) => {
      const r = new Range();
      r.selectNodeContents(el);
      getSelection()?.removeAllRanges();
      getSelection()?.addRange(r);
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
  await page.waitForTimeout(500);
  // Still responsive, and the frame still alive.
  expect(await page.evaluate(() => 1)).toBe(1);
  await expect(preview(page).locator('body')).toContainText('trap text');
  await expect(preview(page).locator('#tabsh-theme')).toHaveCount(1);
  // The gadget's paragraph (Markdown line 7) takes a comment, and the card
  // shows its own lines: the clobbering can't fake them.
  await comment(page, 'Plain words', 'Reword.');
  await hover(page, 'Plain words');
  await expect(shown(page).locator('.comment-hover .comment-lines')).toHaveText('L7');
});

test("comments paste into the tab's terminal, one line each", async ({ page, daemon, project }) => {
  writeFileSync(path.join(project, 'plan.md'), PLAN);
  await openApp(page, daemon);
  await openFile(page, project, 'plan.md');
  await comment(page, 'First paragraph.', 'Make it shorter.');
  await comment(page, 'Second paragraph', 'Say more.');
  await expect.poll(() => highlights(page)).toBe(2);
  const send = shown(page).locator('.pane-send');
  await expect(send).toHaveAttribute('title', 'Send 2 comments to Claude');

  await catWithPasteMode(page, true);
  await send.click();
  await expect(rows(page)).toContainText('plan.md for me:');
  await expect(rows(page)).toContainText('- line 3, "First paragraph.": Make it shorter.');
  await expect(rows(page)).toContainText('- lines 5-6, "Second paragraph spans two lines.": Say more.');
  // Sent: the comments and highlights are gone, and the terminal has the keyboard.
  await expect(send).toBeHidden();
  await expect.poll(() => highlights(page)).toBe(0);
  await expect(page.locator('.term.active .xterm-helper-textarea')).toBeFocused();
  await page.keyboard.press('Control+C');
});

test('Send refuses a terminal without bracketed paste, and keeps the comments', async ({
  page,
  daemon,
  project,
}) => {
  writeFileSync(path.join(project, 'plan.md'), PLAN);
  await openApp(page, daemon);
  await openFile(page, project, 'plan.md');
  await comment(page, 'First paragraph.', 'Make it shorter.');
  await catWithPasteMode(page, false);
  await shown(page).locator('.pane-send').click();
  await expect(status(page)).toHaveText("Not sent: the terminal isn't at a prompt that takes a paste safely");
  await expect(rows(page)).not.toContainText('for me:');
  await expect(shown(page).locator('.pane-send')).toBeVisible();
  await page.keyboard.press('Control+C');
});

test("a quote can't end the paste early and run a command", async ({ page, daemon, project }) => {
  const pwned = path.join(project, 'pwned');
  writeFileSync(path.join(project, 'trap.md'), `# Trap\n\nharmless\u001b[201~ touch '${pwned}'\n`);
  await openApp(page, daemon);
  await openFile(page, project, 'trap.md');
  await comment(page, 'harmless', 'Fix this.');
  // At the shell's own prompt: a paste that ended early would run the rest.
  await clearTerminal(page);
  await shown(page).locator('.pane-send').click();
  await expect
    .poll(
      async () =>
        ((await rows(page).textContent()) ?? '').includes('for me:') ||
        ((await status(page).textContent()) ?? '').startsWith('Not sent'),
    )
    .toBe(true);
  await page.waitForTimeout(1000);
  expect(existsSync(pwned)).toBe(false);
  await typeInTerminal(page, '\u0003');
});

test('hovering a highlight shows its comment, to edit or delete', async ({ page, daemon, project }) => {
  writeFileSync(path.join(project, 'plan.md'), PLAN);
  await openApp(page, daemon);
  await openFile(page, project, 'plan.md');
  await comment(page, 'First paragraph.', 'Make it shorter.');
  const card = shown(page).locator('.comment-hover');

  await hover(page, 'First paragraph.');
  await expect(card).toBeVisible();
  await expect(card.locator('.comment-note')).toHaveText('Make it shorter.');
  await expect(card.locator('.comment-lines')).toHaveText('L3');
  await page.mouse.move(5, 300); // over the terminal
  await expect(card).toBeHidden();

  await hover(page, 'First paragraph.');
  await card.getByRole('button', { name: 'Edit comment' }).click();
  const box = shown(page).locator('.comment-box');
  await expect(box.locator('textarea')).toHaveValue('Make it shorter.');
  await box.locator('textarea').fill('Cut it to one line.');
  await box.getByRole('button', { name: 'Save' }).click();
  await hover(page, 'First paragraph.');
  await expect(card.locator('.comment-note')).toHaveText('Cut it to one line.');

  await card.getByRole('button', { name: 'Delete comment' }).click();
  await expect(card).toBeHidden();
  await expect(shown(page).locator('.pane-send')).toBeHidden();
  await expect.poll(() => highlights(page)).toBe(0);
});

test('Esc closes the comment box without leaving the pane', async ({ page, daemon, project }) => {
  writeFileSync(path.join(project, 'plan.md'), PLAN);
  await openApp(page, daemon);
  await openFile(page, project, 'plan.md');
  await select(page, 'First paragraph.');
  await shown(page).locator('.comment-menu [role="menuitem"]').click();
  await shown(page).locator('.comment-box textarea').fill('never mind');
  await page.keyboard.press('Escape');
  await expect(shown(page).locator('.comment-box')).toBeHidden();
  await expect(page.locator('.term.active .xterm-helper-textarea')).not.toBeFocused();
  await expect(shown(page).locator('.pane-send')).toBeHidden();
});

test('the Comment button sits above a selection, below it under the header, inside the pane', async ({
  page,
  daemon,
  project,
}) => {
  writeFileSync(path.join(project, 'plan.md'), PLAN);
  await openApp(page, daemon);
  await openFile(page, project, 'plan.md');
  const menu = shown(page).locator('.comment-menu');
  const pane = (await page.locator('#pane').boundingBox())!;
  const inside = async () => {
    const m = (await menu.boundingBox())!;
    expect(m.x).toBeGreaterThanOrEqual(pane.x);
    expect(m.x + m.width).toBeLessThanOrEqual(pane.x + pane.width);
  };

  await select(page, 'Second paragraph');
  const para = (await preview(page).getByText('Second paragraph').boundingBox())!;
  await expect(menu).toBeVisible();
  expect((await menu.boundingBox())!.y + (await menu.boundingBox())!.height).toBeLessThanOrEqual(para.y);
  await inside();

  await select(page, 'Plan');
  const title = (await preview(page).getByRole('heading', { name: 'Plan' }).boundingBox())!;
  expect((await menu.boundingBox())!.y).toBeGreaterThanOrEqual(title.y + title.height - 2); // the text's own box ends a little above the heading's line box
  await inside();
});

test('a whole-document selection pastes a cut quote', async ({ page, daemon, project }) => {
  writeFileSync(path.join(project, 'long.md'), `# Long\n\n${'word '.repeat(2000)}\n`);
  await openApp(page, daemon);
  await openFile(page, project, 'long.md');
  await expect(async () => {
    await preview(page)
      .locator('body')
      .evaluate(() => {
        const range = new Range();
        range.selectNodeContents(document.body);
        getSelection()?.removeAllRanges();
        getSelection()?.addRange(range);
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      });
    await expect(shown(page).locator('.comment-menu')).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 10_000 });
  // Fully inside the pane, before anything scrolls it into view.
  const pane = (await page.locator('#pane').boundingBox())!;
  const m = (await shown(page).locator('.comment-menu').boundingBox())!;
  expect(m.x).toBeGreaterThanOrEqual(pane.x);
  expect(m.x + m.width).toBeLessThanOrEqual(pane.x + pane.width);
  expect(m.y).toBeGreaterThanOrEqual(pane.y);
  expect(m.y + m.height).toBeLessThanOrEqual(pane.y + pane.height);
  await shown(page).locator('.comment-menu [role="menuitem"]').click();
  // The box opens where the button was, inside the pane.
  const b = (await shown(page).locator('.comment-box').boundingBox())!;
  expect(b.y).toBeGreaterThanOrEqual(pane.y);
  expect(b.y + b.height).toBeLessThanOrEqual(pane.y + pane.height);
  await shown(page).locator('.comment-box textarea').fill('Trim.');
  await page.keyboard.press('ControlOrMeta+Enter');
  await catWithPasteMode(page, true);
  await shown(page).locator('.pane-send').click();
  await expect(rows(page)).toContainText('- lines 1-3, "Long word word');
  await expect(rows(page)).toContainText('…": Trim.');
  await page.keyboard.press('Control+C');
});

test('comments are found again after the file changes on disk', async ({ page, daemon, project }) => {
  const file = path.join(project, 'moving.md');
  writeFileSync(file, '# Moving\n\nKeep me.\n\nChange me.\n');
  await openApp(page, daemon);
  await openFile(page, project, 'moving.md');
  await comment(page, 'Keep me.', 'A');
  await comment(page, 'Change me.', 'B');
  writeFileSync(file, '# Moving\n\nNew intro.\n\nKeep me.\n\nSomething else.\n');
  // The pane checks the disk every 2 s and re-renders the preview in place.
  await expect(preview(page).locator('body')).toContainText('New intro.', { timeout: 10_000 });
  await expect(status(page)).toHaveText('1 comment no longer matches the file');
  expect(await highlights(page)).toBe(1);
  await catWithPasteMode(page, true);
  await shown(page).locator('.pane-send').click();
  await expect(rows(page)).toContainText('- line 5, "Keep me.": A');
  await expect(rows(page)).toContainText('- line 5, "Change me.": B');
  await page.keyboard.press('Control+C');
});

test('a repeated passage keeps its comment on the one picked', async ({ page, daemon, project }) => {
  const file = path.join(project, 'twice.md');
  writeFileSync(file, '# Twice\n\nSame line.\n\nSame line.\n');
  await openApp(page, daemon);
  await openFile(page, project, 'twice.md');
  await comment(page, 'Same line.', 'The second one.', 1);
  writeFileSync(file, '# Twice\n\nTop.\n\nSame line.\n\nSame line.\n');
  await expect(preview(page).locator('body')).toContainText('Top.', { timeout: 10_000 });
  await catWithPasteMode(page, true);
  await shown(page).locator('.pane-send').click();
  await expect(rows(page)).toContainText('- line 7, "Same line.": The second one.');
  await page.keyboard.press('Control+C');
});

test('comments survive the source view and a theme change', async ({ page, daemon, project }) => {
  writeFileSync(path.join(project, 'plan.md'), PLAN);
  await openApp(page, daemon);
  await openFile(page, project, 'plan.md');
  await comment(page, 'First paragraph.', 'Make it shorter.');
  const toggle = () =>
    shown(page).locator('.pane-head button[title^="Edit"], .pane-head button[title^="Preview"]');
  await toggle().click();
  await expect(shown(page).locator('.cm-editor')).toBeVisible();
  await expect(shown(page).locator('.pane-send')).toBeVisible();
  await toggle().click();
  await expect.poll(() => highlights(page)).toBe(1);
  await pickTheme(page, 'GitHub Light');
  expect(await highlights(page)).toBe(1);
  await hover(page, 'First paragraph.');
  await expect(shown(page).locator('.comment-hover .comment-note')).toHaveText('Make it shorter.');
});

test('unsent comments ask before the file goes', async ({ page, daemon, project }) => {
  writeFileSync(path.join(project, 'plan.md'), PLAN);
  writeFileSync(path.join(project, 'other.md'), '# Other\n');
  await openApp(page, daemon);
  await openFile(page, project, 'plan.md');
  await comment(page, 'First paragraph.', 'Make it shorter.');
  const other = page.locator('#explorer').getByRole('treeitem', { name: 'other.md', exact: true });

  page.once('dialog', (d) => {
    expect(d.message()).toBe('Discard 1 unsent comment?');
    void d.dismiss();
  });
  await other.click();
  await expect(shown(page).locator('.pane-head')).toContainText('plan.md');
  await expect(shown(page).locator('.pane-send')).toBeVisible();

  page.once('dialog', (d) => void d.accept());
  await other.click();
  await expect(shown(page).locator('.pane-head')).toContainText('other.md');
  await expect(shown(page).locator('.pane-send')).toBeHidden();
});

test("each tab keeps its own comments, and Send pastes into its own terminal", async ({
  page,
  daemon,
  project,
}) => {
  writeFileSync(path.join(project, 'plan.md'), PLAN);
  writeFileSync(path.join(project, 'other.md'), '# Other\n\nOther text.\n');
  await openApp(page, daemon);
  await openFile(page, project, 'plan.md');
  await comment(page, 'First paragraph.', 'In tab one.');
  const first = page.locator('#tabs .tab:not(.mirror)').first();

  await newTab(page);
  await openFile(page, project, 'other.md');
  await expect(shown(page).locator('.pane-send')).toBeHidden();
  await catWithPasteMode(page, true);

  await first.click();
  await expect(shown(page).locator('.pane-head')).toContainText('plan.md');
  await expect(shown(page).locator('.pane-send')).toHaveAttribute('title', 'Send 1 comment to Claude');
  await catWithPasteMode(page, true);
  await shown(page).locator('.pane-send').click();
  await expect(rows(page)).toContainText('In tab one.');
  await page.keyboard.press('Control+C');
  await page.locator('#tabs .tab:not(.mirror)').nth(1).click();
  await expect(rows(page)).not.toContainText('In tab one.');
  await page.keyboard.press('Control+C');
  // The worker's daemon is shared, and the specs after this one expect a
  // single tab: close the one this test opened.
  const second = page.locator('#tabs .tab:not(.mirror)').nth(1);
  await second.hover();
  await second.getByRole('button', { name: 'Close terminal' }).click();
  await expect(page.locator('#tabs .tab')).toHaveCount(1);
});

test('raw HTML around Markdown renders as it would without comments, and lines still count', async ({
  page,
  daemon,
  project,
}) => {
  writeFileSync(
    path.join(project, 'fold.md'),
    '# Readme\n\n<details><summary>More</summary>\n\nHidden body.\n\n</details>\n\nAfter the fold.\n',
  );
  await openApp(page, daemon);
  await openFile(page, project, 'fold.md');
  await expect(preview(page).locator('body')).toContainText('After the fold.');
  // The body is inside the <details>, as a plain Markdown render has it.
  const inside = await preview(page)
    .locator('body')
    .evaluate(() => {
      const d = document.querySelector('details');
      const p = [...document.querySelectorAll('p')].find((x) => x.textContent === 'Hidden body.');
      return !!d && !!p && d.contains(p);
    });
  expect(inside).toBe(true);
  await comment(page, 'After the fold.', 'Trim.');
  await catWithPasteMode(page, true);
  await shown(page).locator('.pane-send').click();
  await expect(rows(page)).toContainText('- line 9, "After the fold.": Trim.');
  await page.keyboard.press('Control+C');
});

test('the comment box outlives a re-render, its text and all', async ({ page, daemon, project }) => {
  const file = path.join(project, 'draft.md');
  writeFileSync(file, PLAN);
  await openApp(page, daemon);
  await openFile(page, project, 'draft.md');
  await select(page, 'First paragraph.');
  await shown(page).locator('.comment-menu [role="menuitem"]').click();
  const box = shown(page).locator('.comment-box');
  await box.locator('textarea').fill('Keep typing.');
  writeFileSync(file, PLAN.replace('# Plan\n', '# Plan\n\nNew line.\n'));
  // The pane checks the disk every 2 s and re-renders the preview in place.
  await expect(preview(page).locator('body')).toContainText('New line.', { timeout: 10_000 });
  await expect(box).toBeVisible();
  await expect(box.locator('textarea')).toHaveValue('Keep typing.');
  await box.getByRole('button', { name: 'Comment' }).click();
  await expect(box).toBeHidden();
  // The new frame found the passage again, two lines down.
  await expect.poll(() => highlights(page)).toBe(1);
  await expect(status(page)).toHaveText('');
  await catWithPasteMode(page, true);
  await shown(page).locator('.pane-send').click();
  await expect(rows(page)).toContainText('- line 5, "First paragraph.": Keep typing.');
  await page.keyboard.press('Control+C');
});

test('editing a comment outlives a re-render too', async ({ page, daemon, project }) => {
  const file = path.join(project, 'edit.md');
  writeFileSync(file, PLAN);
  await openApp(page, daemon);
  await openFile(page, project, 'edit.md');
  await comment(page, 'First paragraph.', 'Make it shorter.');
  await hover(page, 'First paragraph.');
  await shown(page).locator('.comment-hover').getByRole('button', { name: 'Edit comment' }).click();
  const box = shown(page).locator('.comment-box');
  await box.locator('textarea').fill('Cut it to one line.');
  writeFileSync(file, PLAN.replace('# Plan\n', '# Plan\n\nNew line.\n'));
  await expect(preview(page).locator('body')).toContainText('New line.', { timeout: 10_000 });
  await expect(box).toBeVisible();
  await expect(box.locator('textarea')).toHaveValue('Cut it to one line.');
  await box.getByRole('button', { name: 'Save' }).click();
  await hover(page, 'First paragraph.');
  await expect(shown(page).locator('.comment-hover .comment-note')).toHaveText('Cut it to one line.');
  await expect(shown(page).locator('.comment-hover .comment-lines')).toHaveText('L5');
});

test('Cmd/Ctrl-E and -S typed in the comment box stay in the box', async ({ page, daemon, project }) => {
  writeFileSync(path.join(project, 'plan.md'), PLAN);
  await openApp(page, daemon);
  await openFile(page, project, 'plan.md');
  await select(page, 'First paragraph.');
  await shown(page).locator('.comment-menu [role="menuitem"]').click();
  const box = shown(page).locator('.comment-box');
  await box.locator('textarea').fill('Still here.');
  await expect(box.locator('textarea')).toBeFocused();
  await page.keyboard.press('ControlOrMeta+e');
  await page.keyboard.press('ControlOrMeta+s');
  await page.waitForTimeout(300);
  await expect(shown(page).locator('.cm-editor')).toHaveCount(0);
  await expect(shown(page).locator('.pane-frame')).toHaveCount(1);
  await expect(box).toBeVisible();
  await expect(box.locator('textarea')).toHaveValue('Still here.');
});

test("a re-render that loses nothing leaves another status alone", async ({ page, daemon, project }) => {
  writeFileSync(path.join(project, 'plan.md'), PLAN);
  await openApp(page, daemon);
  await openFile(page, project, 'plan.md');
  await comment(page, 'First paragraph.', 'Make it shorter.');
  await catWithPasteMode(page, false);
  await shown(page).locator('.pane-send').click();
  const refused = "Not sent: the terminal isn't at a prompt that takes a paste safely";
  await expect(status(page)).toHaveText(refused);
  await roundTrip(page);
  await expect.poll(() => highlights(page)).toBe(1);
  await page.waitForTimeout(300);
  await expect(status(page)).toHaveText(refused);
  await typeInTerminal(page, '\u0003');
});

test('a comment across a hard line break is found again', async ({ page, daemon, project }) => {
  writeFileSync(path.join(project, 'hard.md'), '# Hard\n\nhard  \nbreak here\n');
  await openApp(page, daemon);
  await openFile(page, project, 'hard.md');
  await comment(page, 'break here', 'Join these.');
  await expect.poll(() => highlights(page)).toBe(1);
  await roundTrip(page);
  await expect.poll(() => highlights(page)).toBe(1);
  await expect(status(page)).toHaveText('');
});

test('a javascript: link in the Markdown is inert', async ({ page, daemon, project }) => {
  writeFileSync(
    path.join(project, 'link.md'),
    "# Link\n\n[click me](javascript:document.body.dataset.md='ran')\n\n" +
      '<a href="javascript:document.body.dataset.raw=\'ran\'">raw link</a>\n',
  );
  await openApp(page, daemon);
  await openFile(page, project, 'link.md');
  await expect(preview(page).locator('body')).toContainText('raw link');
  const frames = page.frames().length;
  await preview(page).getByText('click me').click();
  await preview(page).getByText('raw link').click();
  await page.waitForTimeout(500);
  const body = preview(page).locator('body');
  await expect(body).toContainText('click me');
  expect(await body.evaluate((el) => Object.keys((el as HTMLElement).dataset))).toEqual([]);
  expect(await body.evaluate(() => location.href)).toBe('about:srcdoc');
  expect(page.frames().length).toBe(frames);
});
