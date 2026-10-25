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

// The palette's Open on another device page, from its Help group.
async function openDevices(page: Page) {
  await page.locator('#settings-btn').click();
  await page.locator('#palette-input').fill('another device');
  await page.getByRole('menuitem', { name: 'Open on another device…' }).click();
  await expect(page.locator('#palette-input')).toHaveAttribute('placeholder', /^Search devices/);
  return page.locator('#palette-menu');
}

const item = (page: Page, name: string | RegExp) => page.locator('#palette-menu').getByRole('menuitem', { name });

// Turns sharing on and waits for the row it unlocks.
async function shareOn(page: Page) {
  await expect(item(page, /^Share over Tailscale/)).toContainText('Off');
  await item(page, /^Share over Tailscale/).click();
  await expect(item(page, 'Add device…')).toBeVisible();
}

// Adds a device, named in the palette's input, and returns its link.
async function addDevice(page: Page): Promise<string> {
  await item(page, 'Add device…').click();
  await expect(page.locator('#palette-input')).toHaveValue('iPhone');
  const added = page.waitForResponse((res) => res.url().endsWith('/api/remote/devices'));
  await page.locator('#palette-input').press('Enter');
  const { url } = await (await added).json();
  await expect(page.locator('#palette-menu .palette-figure svg')).toBeVisible();
  await expect(item(page, /^Copy link/)).toBeVisible();
  expect(url).toMatch(/^http:\/\/\[::1\]:\d+\/app\/#token=.+/);
  return url;
}

// A second browser (its own storage, as a phone would have) opened on the
// device's link, paired once the board shows.
async function pairDevice(browser: Browser, link: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto(link);
  await expect(page.locator('#board')).toBeVisible();
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
  await openDevices(page);
  await shareOn(page);
  const link = await addDevice(page);
  expect(link.startsWith(`http://[::1]:${port(remote)}/app/#token=`)).toBe(true);
  await expect(item(page, /^iPhone/)).toContainText('Not used yet');

  // Pairing over the second listener: the device sees the tab strip.
  const device = await pairDevice(browser, link);
  const token = new URL(link).hash.replace(/^#token=/, '');
  expect(await statusFor(playwright, remote, token)).toBe(200);

  // Reopened, the page reads the device's use, and the link is gone.
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.locator('#palette')).not.toHaveAttribute('open');
  await openDevices(page);
  await expect(item(page, /^iPhone/)).toContainText('Just now');
  await expect(page.locator('#palette-menu .palette-figure')).toHaveCount(0);

  await item(page, /^iPhone/).click();
  await item(page, /^Revoke/).click();
  await expect(item(page, 'Add device…')).toBeVisible();
  await expect(item(page, /^iPhone/)).toHaveCount(0);

  // The revoked token is refused. (Not asserted as the pairing gate: over
  // loopback a page's Origin-less GET of /api/about passes with any token, so
  // the gate only rises for a remote peer, which the guard's unit tests cover.)
  expect(await statusFor(playwright, remote, token)).toBe(401);
  await device.reload();
  await expect(device.locator('#board')).toBeVisible();
  await device.context().close();
});

test('a device added after the page was left is not shown when it reopens', async ({ page, remote }) => {
  await openApp(page, remote);
  await openDevices(page);
  await shareOn(page);

  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/remote/devices', async (route) => {
    await held;
    await route.continue();
  });
  const added = page.waitForResponse((res) => res.url().endsWith('/api/remote/devices'));
  await item(page, 'Add device…').click();
  await page.locator('#palette-input').press('Enter');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.locator('#palette')).not.toHaveAttribute('open');

  release();
  await added;

  await openDevices(page);
  await expect(item(page, /^iPhone/)).toBeVisible();
  await expect(item(page, /^Copy link/)).toHaveCount(0);
  await expect(page.locator('#palette-menu .palette-figure')).toHaveCount(0);
});

test('a device page cannot manage sharing', async ({ page, browser, remote }) => {
  await openApp(page, remote);
  await openDevices(page);
  await shareOn(page);
  const link = await addDevice(page);

  const device = await pairDevice(browser, link);
  await openDevices(device);
  await expect(item(device, 'Open this on the Mac running tabsh.')).toBeVisible();
  await expect(item(device, /^Share over Tailscale/)).toHaveCount(0);
  await expect(item(device, 'Add device…')).toHaveCount(0);
  await device.context().close();
});

test('turning sharing off ends access', async ({ page, browser, playwright, remote }) => {
  await openApp(page, remote);
  await openDevices(page);
  await shareOn(page);
  const link = await addDevice(page);
  const token = new URL(link).hash.replace(/^#token=/, '');
  const device = await pairDevice(browser, link);

  // Over [::1] the device token works while sharing is on.
  const about = `http://[::1]:${port(remote)}/api/about`;
  const headers = { Authorization: `Bearer ${token}` };
  const before = await playwright.request.newContext();
  expect((await before.get(about, { headers })).status()).toBe(200);
  await before.dispose();

  await item(page, /^Share over Tailscale/).click();
  await expect(item(page, 'Add device…')).toHaveCount(0);
  await expect(item(page, /^Share over Tailscale/)).toContainText('Off');

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
