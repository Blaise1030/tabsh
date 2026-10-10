// The landing page's demo frames load from its own script, never with
// loading="lazy": WebKit gives a lazily loaded frame no Navigation API entry,
// so every navigation in it aborts and the framed app never shows a tab.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const landing = readFileSync(new URL('../pages/index.astro', import.meta.url), 'utf8');

test('the demo frames are not natively lazy', () => {
  const frames = landing.match(/<iframe\b[^>]*>/g) ?? [];
  assert.ok(frames.length > 0, 'the landing page frames the demo');
  for (const frame of frames) {
    assert.doesNotMatch(frame, /loading=/, frame);
    assert.match(frame, /data-src="\/demo\//, frame);
  }
});
