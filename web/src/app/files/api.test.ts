import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  displayPath,
  exists,
  type Fetcher,
  FileError,
  filesUrl,
  fileVersion,
  formatSize,
  fromDisk,
  rawBlobUrl,
  readFile,
  saveFile,
  toDisk,
} from './api.ts';

function stub(res: Response) {
  const calls: { path: string; init?: RequestInit }[] = [];
  const f: Fetcher = async (path, init) => {
    calls.push({ path, init });
    return res;
  };
  return { f, calls };
}

test('filesUrl encodes both parts', () => {
  assert.equal(filesUrl('s1', 'my notes/ü.md'), '/api/files?session=s1&path=my%20notes%2F%C3%BC.md');
});
test('exists uses HEAD', async () => {
  const { f, calls } = stub(new Response(null, { status: 404 }));
  assert.equal(await exists(f, 's1', 'a'), false);
  assert.equal(calls[0].init?.method, 'HEAD');
  assert.equal(await exists(stub(new Response(null, { status: 200 })).f, 's1', 'a'), true);
});
test('fileVersion reads the header from a HEAD', async () => {
  const { f, calls } = stub(new Response(null, { status: 200, headers: { 'x-tabsh-version': '12-3' } }));
  assert.equal(await fileVersion(f, 's1', '/a'), '12-3');
  assert.equal(calls[0].init?.method, 'HEAD');
  assert.equal(await fileVersion(stub(new Response(null, { status: 404 })).f, 's1', '/a'), null);
  await assert.rejects(
    fileVersion(stub(new Response(null, { status: 403 })).f, 's1', '/a'),
    (e: unknown) => e instanceof FileError && e.status === 403,
  );
});
test('readFile', async () => {
  const info = { path: '/a', kind: 'text', size: 1, version: 'v', content: 'x', eol: 'lf' };
  assert.deepEqual(await readFile(stub(Response.json(info)).f, 's', 'a'), info);
  await assert.rejects(
    readFile(stub(new Response(null, { status: 403 })).f, 's', 'a'),
    (e: unknown) => e instanceof FileError && e.status === 403 && e.message === 'Permission denied',
  );
  await assert.rejects(readFile(stub(new Response(null, { status: 404 })).f, 's', 'a'), /Not found/);
  await assert.rejects(readFile(stub(new Response(null, { status: 413 })).f, 's', 'a'), /Too large to open here/);
  await assert.rejects(readFile(stub(new Response(null, { status: 500 })).f, 's', 'a'), /Request failed \(500\)/);
});
test('rawBlobUrl', async () => {
  const { f, calls } = stub(new Response('hi'));
  assert.match(await rawBlobUrl(f, '/a b'), /^blob:/);
  assert.equal(calls[0].path, '/api/files/raw?path=%2Fa%20b');
  await assert.rejects(rawBlobUrl(stub(new Response(null, { status: 413 })).f, '/a'), FileError);
});
test('saveFile', async () => {
  const ok = stub(new Response(null, { status: 204, headers: { 'x-tabsh-version': 'v2' } }));
  assert.deepEqual(await saveFile(ok.f, '/a', 'hi', 'v1'), { version: 'v2' });
  assert.equal(ok.calls[0].path, '/api/files');
  assert.equal(ok.calls[0].init?.method, 'PUT');
  assert.deepEqual(JSON.parse(ok.calls[0].init?.body as string), { path: '/a', content: 'hi', version: 'v1' });
  const conflict = stub(new Response('{"version":"v9"}', { status: 409 }));
  assert.deepEqual(await saveFile(conflict.f, '/a', 'hi', 'v1'), { conflict: 'v9' });
  await assert.rejects(saveFile(stub(new Response(null, { status: 403 })).f, '/a', 'x', 'v'), FileError);
});
test('line endings', () => {
  assert.equal(toDisk(fromDisk('a\r\nb\r\n'), 'crlf'), 'a\r\nb\r\n');
  assert.equal(toDisk('a\nb', 'lf'), 'a\nb');
});
test('displayPath', () => {
  assert.equal(displayPath('/p/src/a.rs', '/p'), 'src/a.rs');
  assert.equal(displayPath('/q/a.rs', '/p'), '/q/a.rs');
  assert.equal(displayPath('/p2/a', '/p'), '/p2/a');
  assert.equal(displayPath('/p/a', undefined), '/p/a');
});
test('formatSize', () => {
  assert.equal(formatSize(812), '812 B');
  assert.equal(formatSize(3277), '3.2 KB');
  assert.equal(formatSize(60 * 1024 * 1024), '60 MB');
});
