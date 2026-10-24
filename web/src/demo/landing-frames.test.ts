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

test('fig 1 loads when its poster is clicked', () => {
  const fig1 = landing.slice(landing.indexOf('<figure class="shot">'), landing.indexOf('</figure>'));
  assert.match(fig1, /class="stage"/);
  assert.match(landing, /url\('\/preview-ground\.jpg'\)/);
  assert.match(fig1, /data-run/);
  assert.match(fig1, /Run the live demo/);
  assert.match(fig1, /data-light="\/preview-light\.png/);
  assert.match(fig1, /data-dark="\/preview-dark\.png/);
  assert.match(fig1, /is:inline/);
  assert.doesNotMatch(fig1, /src="\/preview-/);
  assert.doesNotMatch(fig1, /srcset=/);
  assert.doesNotMatch(fig1, /hero\.png/);
  assert.match(fig1, /<iframe\b[^>]*data-src="\/demo\/\?view=board&layout=list"/);
  assert.match(fig1, /<iframe\b[^>]*\bdata-click\b/);
  const boardFrame = landing.slice(landing.indexOf('shot board-fig')).match(/<iframe\b[^>]*>/)?.[0] ?? '';
  assert.doesNotMatch(boardFrame, /data-click/);
  assert.match(landing, /iframe\[data-src\]:not\(\[data-click\]\)/);
  assert.match(landing, /querySelectorAll\('\[data-run\]'\)/);
});
