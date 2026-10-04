import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scanBell, TEXT } from './bell-scan.ts';

const scan = (chunks: string[]) => {
  let esc = TEXT;
  let bells = 0;
  for (const c of chunks) {
    const r = scanBell(esc, new TextEncoder().encode(c));
    esc = r.esc;
    bells += +r.bell;
  }
  return bells;
};
test('a bare BEL rings', () => assert.equal(scan(['make: done\x07']), 1));
test('BEL ending an OSC title does not ring', () => assert.equal(scan(['\x1b]0;~/src\x07$ ']), 0));
test('the OSC state carries across chunks', () => assert.equal(scan(['\x1b]0;ti', 'tle\x07', 'x\x07']), 1));
test('ESC \\ ends a string; DCS, APC, PM and SOS are strings too', () => {
  assert.equal(scan(['\x1b]0;t\x1b\\\x07']), 1);
  for (const intro of ['P', '_', '^', 'X']) assert.equal(scan([`\x1b${intro}data\x07`]), 0, intro);
});
test('CAN aborts a string', () => assert.equal(scan(['\x1b]0;t\x18\x07']), 1));
