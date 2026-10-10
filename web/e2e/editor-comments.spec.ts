// Comments on a source selection: select in the editor, leave a note, send it
// to the tab's terminal without pressing Enter.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { cdInTerminal, expect, openApp, test } from './fixture.ts';

test('a comment on a source selection pastes into the terminal', async ({ page, daemon, project }) => {
  const row = (name: string) => page.locator('#explorer').getByRole('treeitem', { name, exact: true });
  const pane = page.locator('#pane .pane-view:not([hidden])');

  await openApp(page, daemon);
  await cdInTerminal(page, project, 'in-project');
  await page.locator('#explorer-btn').click();
  await row('src').click();
  await row('main.rs').click();
  await expect(pane.locator('.pane-head')).toContainText('main.rs');
  await expect(pane.locator('.cm-content')).toBeVisible();

  await pane.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  const comment = pane.locator('.comment-menu');
  await expect(comment).toBeVisible();
  await comment.getByRole('menuitem', { name: 'Comment' }).click();
  const box = pane.locator('.comment-box');
  await expect(box.locator('.comment-quote-lead')).toContainText('fn main()');
  await expect(box.getByRole('button', { name: 'Queue' })).toBeVisible();
  await expect(box.getByRole('button', { name: 'Send directly' })).toBeVisible();
  await expect(box.getByRole('button', { name: 'Cancel' })).toBeVisible();
  await pane.locator('textarea[aria-label="Comment"]').fill('Say what main does.');
  await page.keyboard.press('Shift+Enter');

  await expect(pane.locator('.cm-comment')).toHaveCount(1);
  await expect(pane.locator('.pane-send-badge')).toHaveText('1');
  await pane.locator('.pane-send').click();
  await expect(pane.locator('.pane-comments')).toBeVisible();
  await expect(pane.locator('.comment-row .comment-quote')).toContainText('fn main()');
  await expect(pane.locator('.comment-row')).toContainText('Say what main does.');
  await pane.locator('.comment-row').click();
  await expect(pane.locator('.cm-content')).toContainText('fn main()');
  await pane.locator('.pane-comments-send').click();

  await expect(pane.locator('.cm-comment')).toHaveCount(0);
  await expect(page.locator('.xterm-screen')).toContainText('Make these changes to');
  await expect(page.locator('.xterm-screen')).toContainText('fn main() {}');
  await expect(page.locator('.xterm-screen')).toContainText('Say what main does.');
});

test('a comment shows its quote in the list and in the markdown preview', async ({ page, daemon, project }) => {
  const row = (name: string) => page.locator('#explorer').getByRole('treeitem', { name, exact: true });
  const pane = page.locator('#pane .pane-view:not([hidden])');
  const toggle = () => pane.locator('.pane-head button[title^="Edit"], .pane-head button[title^="Preview"]');

  writeFileSync(path.join(project, 'README.md'), '# project\n\n1. **GATHER**: `ctx_batch` runs it.\n');
  await openApp(page, daemon);
  await cdInTerminal(page, project, 'in-project');
  await page.locator('#explorer-btn').click();
  await row('README.md').click();
  await expect(pane.locator('.pane-head')).toContainText('README.md');
  await toggle().click();
  await expect(pane.locator('.cm-content')).toBeVisible();

  await pane.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await pane.locator('.comment-menu').getByRole('menuitem', { name: 'Comment' }).click();
  await pane.locator('textarea[aria-label="Comment"]').fill('Explain the title.');
  await page.keyboard.press('Shift+Enter');

  await pane.locator('.pane-send').click();
  await expect(pane.locator('.comment-row .comment-quote')).toContainText('# project');
  await expect(pane.locator('.comment-row')).toContainText('Explain the title.');

  await toggle().click();
  const preview = pane.frameLocator('.pane-frame');
  await expect(preview.locator('.tabsh-comment').first()).toContainText('# project');
  await expect(preview.locator('.tabsh-comment').first()).toContainText('Explain the title.');
  await expect(preview.locator('h1')).toContainText('project');

  await preview.locator('h1').evaluate((el) => {
    const range = el.ownerDocument.createRange();
    range.selectNodeContents(el);
    const sel = el.ownerDocument.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    el.ownerDocument.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await expect(pane.locator('.comment-menu')).toBeVisible();
  await expect(pane.locator('.comment-menu')).toContainText('Comment');

  // A list item has no heading span. Selecting it still offers Comment.
  await preview.locator('li').evaluate((el) => {
    el.ownerDocument.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  });
  await expect(pane.locator('.comment-menu')).toBeHidden();
  await preview.locator('li').evaluate((el) => {
    const range = el.ownerDocument.createRange();
    range.selectNodeContents(el);
    const sel = el.ownerDocument.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    el.ownerDocument.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  });
  await expect(pane.locator('.comment-menu')).toBeVisible();

  // A fast release never delivers mouseup. The selection change is enough.
  await preview.locator('li').evaluate((el) => {
    const doc = el.ownerDocument;
    doc.getSelection()?.removeAllRanges();
    doc.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    const range = doc.createRange();
    range.selectNodeContents(el);
    doc.getSelection()?.addRange(range);
    doc.dispatchEvent(new Event('selectionchange'));
  });
  await expect(pane.locator('.comment-menu')).toBeVisible();
});

test('comments on two files stay in one list', async ({ page, daemon, project }) => {
  const row = (name: string) => page.locator('#explorer').getByRole('treeitem', { name, exact: true });
  const pane = page.locator('#pane .pane-view:not([hidden])');
  const toggle = () => pane.locator('.pane-head button[title^="Edit"], .pane-head button[title^="Preview"]');

  await openApp(page, daemon);
  await cdInTerminal(page, project, 'in-project');
  await page.locator('#explorer-btn').click();
  await row('src').click();
  await row('main.rs').click();
  await expect(pane.locator('.cm-content')).toBeVisible();
  await pane.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await pane.locator('.comment-menu').getByRole('menuitem', { name: 'Comment' }).click();
  await pane.locator('textarea[aria-label="Comment"]').fill('Say what main does.');
  await page.keyboard.press('Shift+Enter');
  await expect(pane.locator('.pane-send-badge')).toHaveText('1');

  await row('README.md').click();
  await expect(pane.locator('.pane-head')).toContainText('README.md');
  await expect(pane.locator('.pane-send-badge')).toHaveText('1');
  await toggle().click();
  await expect(pane.locator('.cm-content')).toBeVisible();
  await pane.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await pane.locator('.comment-menu').getByRole('menuitem', { name: 'Comment' }).click();
  await pane.locator('textarea[aria-label="Comment"]').fill('Explain the title.');
  await page.keyboard.press('Shift+Enter');

  await expect(pane.locator('.pane-send-badge')).toHaveText('2');
  await pane.locator('.pane-send').click();
  const rows = pane.locator('.comment-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({ hasText: 'main.rs' })).toContainText('Say what main does.');
  await expect(rows.filter({ hasText: 'README.md' })).toContainText('Explain the title.');

  await rows.filter({ hasText: 'main.rs' }).click();
  await expect(pane.locator('.pane-head')).toContainText('main.rs');
  await expect(pane.locator('.cm-content')).toContainText('fn main()');
  await pane.locator('.pane-comments-send').click();

  await expect(pane.locator('.pane-send')).toBeHidden();
  await expect(page.locator('.xterm-screen')).toContainText('main.rs');
  await expect(page.locator('.xterm-screen')).toContainText('Say what main does.');
  await expect(page.locator('.xterm-screen')).toContainText('README.md');
  await expect(page.locator('.xterm-screen')).toContainText('Explain the title.');
});
