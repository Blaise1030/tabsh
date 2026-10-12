// Open on another device, end to end: turn sharing on, add a device, pair a
// second browser with its link over the second listener, revoke it. The daemon
// is started with TABSH_REMOTE_ADDRESS=::1, so the sharing listener binds
// [::1]:<port> beside 127.0.0.1:<port>. `::1` is loopback, so the guard's
// remote-peer rules do not apply here; the Rust unit tests cover them.
import net from 'node:net';
import type { Browser, Page, PlaywrightWorkerArgs } from '@playwright/test';
import { startDaemon, type Daemon } from './daemon.ts';
import { expect, openApp, test as base } from './fixture.ts';

// A daemon of this spec's own (the shared one lacks the env var), one per test
// so sharing and devices never leak between tests.
const test = base.extend<{ remote: Daemon }>({
  remote: async ({}, use, testInfo) => {
    const hasIpv6 = await new Promise<boolean>((resolve) => {
      const probe = net.createServer();
      probe.on('error', () => resolve(false));
      probe.listen(0, '::1', () => probe.close(() => resolve(true)));
    });
    testInfo.skip(!hasIpv6, 'this machine has no IPv6 loopback ([::1]), which the remote listener needs here');
    const daemon = await startDaemon({ env: { TABSH_REMOTE_ADDRESS: '::1' } });
    await use(daemon);
    await daemon.cleanup();
  },
});

const port = (daemon: Daemon) => new URL(daemon.baseUrl).port;

// The dialog, opened from the palette's Help group.
async function openDialog(page: Page) {
  await page.locator('#settings-btn').click();
  await page.locator('#palette-input').fill('another device');
  await page.getByRole('menuitem', { name: 'Open on another device…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Open on another device' });
  // The dialog element itself has no box (Basecoat lays the form out as the
  // panel), so playwright calls it hidden: the title stands for it.
  await expect(dialog.getByRole('heading', { name: 'Open on another device' })).toBeVisible();
  return dialog;
}

// Turns sharing on in the open dialog and waits for the controls it unlocks.
async function shareOn(page: Page) {
  const dialog = page.getByRole('dialog', { name: 'Open on another device' });
  const share = dialog.getByRole('switch', { name: 'Share over Tailscale' });
  await expect(share).not.toBeChecked();
  await share.check();
  await expect(dialog.getByRole('button', { name: 'Add device' })).toBeVisible();
  return dialog;
}

// Adds a device in the open dialog and returns its link.
async function addDevice(page: Page): Promise<string> {
  const dialog = page.getByRole('dialog', { name: 'Open on another device' });
  await expect(dialog.getByRole('textbox', { name: 'Device name' })).toHaveValue('iPhone');
  await dialog.getByRole('button', { name: 'Add device' }).click();
  await expect(dialog.locator('.remote-qr svg')).toBeVisible();
  const link = dialog.getByRole('textbox', { name: 'Device link' });
  await expect(link).toHaveValue(/^http:\/\/\[::1\]:\d+\/app\/#token=.+/);
  return link.inputValue();
}

// A second browser (its own storage, as a phone would have) opened on the
// device's link, paired once the tab strip shows.
async function pairDevice(browser: Browser, link: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto(link);
  await expect(page.locator('#tabs')).toBeVisible();
  await expect(page.locator('#gate')).toBeHidden();
  return page;
}

// What the daemon answers a request that carries `token` the way a browser
// page does: with its Origin. (A loopback request with no Origin gets past the
// token check, so without it `::1` would say nothing about revocation.)
async function statusFor(playwright: PlaywrightWorkerArgs['playwright'], daemon: Daemon, token: string) {
  const origin = `http://[::1]:${port(daemon)}`;
  const ctx = await playwright.request.newContext();
  try {
    const res = await ctx.get(`${origin}/api/about`, { headers: { Authorization: `Bearer ${token}`, Origin: origin } });
    return res.status();
  } finally {
    await ctx.dispose();
  }
}

test('share, pair a device and revoke it', async ({ page, browser, playwright, remote }) => {
  await openApp(page, remote);
  await openDialog(page);
  const dialog = await shareOn(page);
  const link = await addDevice(page);
  expect(link.startsWith(`http://[::1]:${port(remote)}/app/#token=`)).toBe(true);
  await expect(dialog.getByRole('button', { name: 'Copy link' })).toBeVisible();
  await expect(dialog.locator('.remote-device-seen')).toHaveText('Not used yet');

  // Pairing over the second listener: the device sees the tab strip.
  const device = await pairDevice(browser, link);
  const token = new URL(link).hash.replace(/^#token=/, '');
  expect(await statusFor(playwright, remote, token)).toBe(200);

  // Reopened, the dialog reads the device's use.
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog.getByRole('heading')).toBeHidden();
  await openDialog(page);
  await expect(dialog.locator('.remote-device-name')).toHaveText('iPhone');
  await expect(dialog.locator('.remote-device-seen')).toHaveText('Just now');

  await dialog.getByRole('button', { name: 'Revoke' }).click();
  await expect(dialog.locator('.remote-device')).toHaveCount(0);

  // The revoked token is refused. (Not asserted as the pairing gate: over
  // loopback a page's Origin-less GET of /api/about passes with any token, so
  // the gate only rises for a remote peer, which the guard's unit tests cover.)
  expect(await statusFor(playwright, remote, token)).toBe(401);
  await device.reload();
  await expect(device.locator('#tabs')).toBeVisible();
  await device.context().close();
});

test('a device page cannot open the dialog', async ({ page, browser, remote }) => {
  await openApp(page, remote);
  await openDialog(page);
  await shareOn(page);
  const link = await addDevice(page);

  const device = await pairDevice(browser, link);
  const dialog = await openDialog(device);
  await expect(dialog).toContainText('Open this on the Mac running tabsh.');
  await expect(dialog.getByRole('switch', { name: 'Share over Tailscale' })).toBeHidden();
  await expect(dialog.getByRole('button', { name: 'Add device' })).toBeHidden();
  await device.context().close();
});

test('turning sharing off ends access', async ({ page, browser, playwright, remote }) => {
  await openApp(page, remote);
  await openDialog(page);
  const dialog = await shareOn(page);
  const link = await addDevice(page);
  const token = new URL(link).hash.replace(/^#token=/, '');
  const device = await pairDevice(browser, link);

  // Over [::1] the device token works while sharing is on.
  const about = `http://[::1]:${port(remote)}/api/about`;
  const headers = { Authorization: `Bearer ${token}` };
  const before = await playwright.request.newContext();
  expect((await before.get(about, { headers })).status()).toBe(200);
  await before.dispose();

  await dialog.getByRole('switch', { name: 'Share over Tailscale' }).uncheck();
  await expect(dialog.getByRole('button', { name: 'Add device' })).toBeHidden();

  // A fresh connection finds nothing listening on [::1].
  await expect(async () => {
    const fresh = await playwright.request.newContext();
    try {
      await expect(fresh.get(about, { headers })).rejects.toThrow(/ECONNREFUSED|connect/i);
    } finally {
      await fresh.dispose();
    }
  }).toPass({ timeout: 10_000 });
  await device.context().close();
});
