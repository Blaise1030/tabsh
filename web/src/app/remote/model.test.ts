import assert from 'node:assert/strict';
import test from 'node:test';
import { lastSeen, type RemoteDevice, type RemoteInfo, remoteMessage, remoteScreen } from './model.ts';

const on: RemoteInfo = { enabled: true, address: '100.86.117.9', port: 7777, host: null, error: null, devices: [] };
const dev: RemoteDevice = { id: 'a', name: 'iPhone', created: 0, last_seen: null };

test('a device token gets the forbidden screen', () => assert.equal(remoteScreen('forbidden'), 'forbidden'));
test('a fixed host wins over everything else', () =>
  assert.equal(remoteScreen({ ...on, host: '192.168.1.2' }), 'host'));
test('no address is no-tailscale, even when enabled', () =>
  assert.equal(remoteScreen({ ...on, address: null }), 'no-tailscale'));
test('off and on', () => {
  assert.equal(remoteScreen({ ...on, enabled: false }), 'off');
  assert.equal(remoteScreen(on), 'on');
});
test('last seen', () => {
  assert.equal(lastSeen({ ...dev, last_seen: null }, 1000), 'Not used yet');
  assert.equal(lastSeen({ ...dev, last_seen: 990 }, 1000), 'Just now');
  assert.equal(lastSeen({ ...dev, last_seen: 700 }, 1000), '5 min ago');
  assert.equal(lastSeen({ ...dev, last_seen: 1000 - 3 * 3600 }, 1000), '3 h ago');
  assert.equal(lastSeen({ ...dev, last_seen: 1000 - 2 * 86400 }, 1000), '2 d ago');
});

test('only the screens without controls have a message', () => {
  assert.equal(remoteMessage('forbidden'), 'Open this on the Mac running tabsh.');
  assert.equal(
    remoteMessage({ ...on, host: '192.168.1.2' }),
    'tabsh already listens on 192.168.1.2. Sharing is set by HOST.',
  );
  assert.match(remoteMessage({ ...on, address: null }) ?? '', /^Install Tailscale on this Mac/);
  assert.equal(remoteMessage(on), null);
  assert.equal(remoteMessage({ ...on, enabled: false }), null);
});
