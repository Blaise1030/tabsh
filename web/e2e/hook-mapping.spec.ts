// `tabsh hook` with no argument: an agent's hook JSON arrives on stdin and
// maps to the tab's state — the same markers as `tabsh hook <state>`, but
// reached from real hook payloads, wherever the event name hides
// (`hook_event_name`, `event`) and however it's spelled. Unknown events and
// unparseable input send nothing: the hook stays silent and exits 0.
import type { Page } from '@playwright/test';
import type { Daemon } from './daemon.ts';
import { expect, newTab, openApp, test, typeInTerminal } from './fixture.ts';

// A tab by its place in the strip: 0 is the auto-opened first terminal (A),
// 1 the one the spec creates (B).
const tab = (page: Page, i: number) => page.locator('#tabs .tab').nth(i);

// Pipe a hook payload into `tabsh hook`, optionally running more shell after
// the pipeline. Anything appended only runs once the hook has exited, so
// renaming the tab there (smoke.spec.ts's DOM effect — xterm paints to
// canvas, which cannot be asserted) proves the hook had its chance before
// the "nothing changed" assertions around it. ^C first keeps any retry (a
// keystroke landing before the tab's socket opens) on a fresh prompt line;
// the daemon's own binary is spelled out because a login shell on some
// systems (CI's bash) rebuilds PATH from /etc/profile.
const hook = (daemon: Daemon, page: Page, json: string, then = '') =>
  expect(async () => {
    await typeInTerminal(page, `\u0003echo '${json}' | ${daemon.bin} hook; ${then}`);
    await page.keyboard.press('Enter');
  }).toPass({ timeout: 10_000 });

const label = (page: Page) => page.locator('#tabs .tab[aria-selected="true"] span');

test('hook json on stdin maps to the tab state', async ({ page, daemon }) => {
  await openApp(page, daemon);
  await newTab(page); // tab B, where the "agent" runs
  await tab(page, 0).click(); // keep A active…
  await expect(tab(page, 0)).toHaveAttribute('aria-selected', 'true');
  await tab(page, 1).click(); // …then work in B, and stay there: ✓ only
  // clears when B is visited again, which these steps never do.

  // Claude-style PreToolUse → spinner.
  await hook(daemon, page, '{"hook_event_name":"PreToolUse","tool_name":"Bash"}');
  await expect(tab(page, 1)).toHaveClass(/running/);

  // Goose-style `event` field; permission_prompt → the orange dot.
  await hook(daemon, page, '{"event":"Notification","notification_type":"permission_prompt"}');
  await expect(tab(page, 1)).toHaveClass(/needs/);

  // The same Notification with the type in `type`, another spelling →
  // still the dot.
  await hook(daemon, page, '{"hook_event_name":"Notification","type":"ToolPermission"}');
  await expect(tab(page, 1)).toHaveClass(/needs/);

  // A granted permission returns the agent to running (PostToolUse after
  // the grant). Only running → idle is a ✓: a Stop straight from
  // needs-input would mean "you just answered it", not done.
  await hook(daemon, page, '{"hook_event_name":"PostToolUse","tool_name":"Bash"}');
  await expect(tab(page, 1)).toHaveClass(/running/);

  // Stop → ✓ done.
  await hook(daemon, page, '{"hook_event_name":"Stop"}');
  await expect(tab(page, 1)).toHaveClass(/done/);

  // idle_prompt is the reminder after the turn ended: ignored, ✓ stays.
  await hook(
    daemon,
    page,
    '{"hook_event_name":"Notification","notification_type":"idle_prompt"}',
    "printf '\\033]0;after-idle\\007'",
  );
  await expect(label(page)).toHaveText('after-idle');
  // The rename can land just before a wrongly-sent state would, so give
  // that state its chance before asserting it never came.
  await page.waitForTimeout(300);
  await expect(tab(page, 1)).toHaveClass(/done/);

  // Not JSON: nothing sent — the ✓ stays, the hook prints nothing and
  // exits 0. The tab is renamed "<exit>:<output length>": `0:0` proves
  // both, and having the hook finished bounds the "nothing changed" assert.
  await expect(async () => {
    await typeInTerminal(
      page,
      `\u0003out=$(echo 'not json' | ${daemon.bin} hook); printf '\\033]0;%s:%s\\007' "$?" "\${#out}"`,
    );
    await page.keyboard.press('Enter');
  }).toPass({ timeout: 10_000 });
  await expect(label(page)).toHaveText('0:0');
  await page.waitForTimeout(300);
  await expect(tab(page, 1)).toHaveClass(/done/);
});
