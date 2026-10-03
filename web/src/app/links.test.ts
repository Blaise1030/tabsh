import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findLinks } from './links.ts';

const texts = (s: string) => findLinks(s).map((f) => [f.kind, f.text, f.line, f.col]);

test('urls', () => {
  assert.deepEqual(texts('see https://x.dev/a.'), [['url', 'https://x.dev/a', undefined, undefined]]);
  assert.deepEqual(texts('(see https://x.dev/a)'), [['url', 'https://x.dev/a', undefined, undefined]]);
  assert.deepEqual(texts('https://en.wikipedia.org/wiki/Foo_(bar)'), [['url', 'https://en.wikipedia.org/wiki/Foo_(bar)', undefined, undefined]]);
  assert.deepEqual(texts('ftp://x.dev'), []);
});
test('paths with positions', () => {
  assert.deepEqual(texts('  --> src/main.rs:42:7'), [['path', 'src/main.rs', 42, 7]]);
  assert.deepEqual(texts('    at run (/Users/me/app/x.js:10:5)'), [['path', '/Users/me/app/x.js', 10, 5]]);
  assert.deepEqual(texts('~/notes.md:3'), [['path', '~/notes.md', 3, undefined]]);
});
test('ls and git status output', () => {
  assert.deepEqual(texts('Cargo.toml  README.md  src'), [['path', 'Cargo.toml', undefined, undefined], ['path', 'README.md', undefined, undefined]]);
  assert.deepEqual(texts('\tmodified:   web/src/pages/app/index.astro'), [['path', 'web/src/pages/app/index.astro', undefined, undefined]]);
});
test('not paths', () => {
  assert.deepEqual(texts('and/or 1.2.3 e.g. v1.2 // ...'), [['path', 'and/or', undefined, undefined]]);
});
test('a url is not also a path', () => {
  assert.deepEqual(texts('http://localhost:5173/src/x.ts').map(([k]) => k), ['url']);
});
test('offsets cover the suffix', () => {
  const [f] = findLinks('x src/a.rs:1:2 y');
  assert.equal('x src/a.rs:1:2 y'.slice(f.start, f.end), 'src/a.rs:1:2');
});
test('trailing closers are trimmed in linear time', () => {
  const t0 = performance.now();
  const found = texts('https://x.dev/a' + ')'.repeat(20_000));
  const ms = performance.now() - t0;
  assert.deepEqual(found, [['url', 'https://x.dev/a', undefined, undefined]]);
  assert.ok(ms < 200, `took ${ms.toFixed(0)} ms`);
});
test('abbreviations are not links', () => {
  assert.deepEqual(texts('e.g.'), []);
  assert.deepEqual(texts('i.e.'), []);
  assert.deepEqual(texts('as in e.g. this, i.e. that'), []);
});
test('a sentence-ending path keeps its position', () => {
  assert.deepEqual(texts('src/a.rs:1:2.'), [['path', 'src/a.rs', 1, 2]]);
});
test('only http(s) urls', () => {
  assert.deepEqual(texts('ftp://x.dev/a'), []);
});
test('mixed closers and punctuation', () => {
  assert.deepEqual(texts('[see https://x.dev/a_(b)].'), [['url', 'https://x.dev/a_(b)', undefined, undefined]]);
  assert.deepEqual(texts('{https://x.dev/a?}'), [['url', 'https://x.dev/a', undefined, undefined]]);
  assert.deepEqual(texts('https://x.dev/a)).;'), [['url', 'https://x.dev/a', undefined, undefined]]);
});
