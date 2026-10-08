// The app builds its DOM with VanJS tags, never from markup strings: nothing in
// web/src/app injects HTML, and the old el() helper is gone.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const root = new URL('..', import.meta.url).pathname;

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path);
    return e.name.endsWith('.ts') && !e.name.endsWith('.test.ts') ? [path] : [];
  });
}

const files = sources(root);

test('no file injects markup', () => {
  const bad = files.filter((f) => /innerHTML|outerHTML|insertAdjacentHTML/.test(readFileSync(f, 'utf8')));
  assert.deepEqual(bad, []);
});

test('nothing imports el from dom.ts', () => {
  const bad = files.filter((f) =>
    /import\s*\{[^}]*\bel\b[^}]*\}\s*from\s*'[^']*dom\.ts'/.test(readFileSync(f, 'utf8')),
  );
  assert.deepEqual(bad, []);
});
