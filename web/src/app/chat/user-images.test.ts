import assert from 'node:assert/strict';
import { test } from 'node:test';
import { splitAttachedImages } from './user-images.ts';

test('splitAttachedImages pulls trailing image paths after the prompt', () => {
  const { body, images } = splitAttachedImages('look\n\n/Users/me/.tabsh/uploads/a.png\n/tmp/b.jpg');
  assert.equal(body, 'look');
  assert.deepEqual(images, ['/Users/me/.tabsh/uploads/a.png', '/tmp/b.jpg']);
});

test('splitAttachedImages leaves non-image paths in the body', () => {
  const { body, images } = splitAttachedImages('see /Users/me/src/main.rs');
  assert.equal(body, 'see /Users/me/src/main.rs');
  assert.deepEqual(images, []);
});

test('splitAttachedImages handles image-only messages', () => {
  const { body, images } = splitAttachedImages('/Users/me/.tabsh/uploads/shot.png');
  assert.equal(body, '');
  assert.deepEqual(images, ['/Users/me/.tabsh/uploads/shot.png']);
});
