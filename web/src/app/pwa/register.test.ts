import assert from 'node:assert/strict';
import { test } from 'node:test';
import { serviceWorkerUrl } from './register.ts';

test('only the app page gets a service worker', () => {
  assert.equal(serviceWorkerUrl('/app/'), '/app/sw.js');
  assert.equal(serviceWorkerUrl('/app'), '/app/sw.js');
  assert.equal(serviceWorkerUrl('/demo/'), null);
  assert.equal(serviceWorkerUrl('/'), null);
  assert.equal(serviceWorkerUrl('/apple'), null);
});
