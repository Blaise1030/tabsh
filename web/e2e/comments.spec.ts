// Markdown comments, end to end: the preview's frame runs only tabsh's
// script; a comment pastes into the tab's terminal; comments outlive a
// re-render, and stay with their tab.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { cdInTerminal, expect, openApp, pickTheme, test } from './fixture.ts';

const shown = (page: Page) => page.locator('#pane .pane-view:not([hidden])');
const preview = (page: Page) => shown(page).frameLocator('.pane-frame');

// Opens `name`, in `project`, from the explorer in the active tab.
async function openFile(page: Page, project: string, name: string): Promise<void> {
  await cdInTerminal(page, project, `in-${name}`);
  if ((await page.locator('#explorer-btn').getAttribute('aria-pressed')) !== 'true') {
    await page.locator('#explorer-btn').click();
  }
  await page.locator('#explorer').getByRole('treeitem', { name, exact: true }).click();
  await expect(shown(page).locator('.pane-head')).toContainText(name);
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
      `<script src="${entry}"></script>`,
      '',
      `<script src="${forged}"></script>`,
      '',
      '<script src="https://cdn.jsdelivr.net/npm/left-pad@1.3.0/index.js"></script>',
      '',
    ].join('\n'),
  );
  await openFile(page, project, 'hostile.md');
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
});
