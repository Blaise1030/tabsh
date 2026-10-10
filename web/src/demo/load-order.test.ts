// The demo page's script may only import the pretend daemon. The app starts
// from a dynamic import at the end of daemon.ts, after fetch, WebSocket and
// storage are replaced. A static import is evaluated first, so the app's
// opening /api/about would be a real request and the page's connect-src
// would refuse http://demo.tabsh.invalid.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const page = readFileSync(new URL('../pages/demo/index.astro', import.meta.url), 'utf8');
const daemon = readFileSync(new URL('./daemon.ts', import.meta.url), 'utf8');

test('the demo page does not import the app', () => {
  assert.doesNotMatch(page, /import\s+['"][^'"]*app\/main\.ts['"]/);
  assert.match(page, /import\s+['"][^'"]*demo\/daemon\.ts['"]/);
});

test('the pretend daemon starts the app after replacing fetch', () => {
  const start = daemon.search(/import\s*\(\s*['"]\.\.\/app\/main\.ts['"]\s*\)/);
  assert.ok(start !== -1, 'daemon.ts dynamically imports the app');
  for (const marker of ["'localStorage'", 'window.WebSocket', 'window.fetch']) {
    const at = daemon.indexOf(marker);
    assert.ok(at !== -1 && at < start, `${marker} is replaced before the app starts`);
  }
});
