import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { OG_IMAGE, pageSeo } from './seo.ts';

const title = 'tabsh: your terminal, in a browser tab';
const description =
  'A tiny Rust daemon runs your shells locally. Open them from any browser tab; they survive reloads and restarts.';

test('the landing page canonical and social image are absolute', () => {
  const seo = pageSeo({ title, description, pathname: '/' });
  assert.equal(seo.canonical, 'https://tabsh.cc/');
  assert.equal(seo.image, 'https://tabsh.cc/og.png');
  assert.equal(seo.imageWidth, 1200);
  assert.equal(seo.imageHeight, 630);
  const graph = JSON.parse(seo.jsonLd)['@graph'] as { '@type': string }[];
  assert.deepEqual(
    graph.map((node) => node['@type']),
    ['WebSite', 'WebPage', 'SoftwareApplication'],
  );
});

test('other marketing pages keep a trailing slash and skip the app schema', () => {
  const seo = pageSeo({ title: 'Docs · tabsh', description: 'Install tabsh.', pathname: '/docs' });
  assert.equal(seo.canonical, 'https://tabsh.cc/docs/');
  const types = (JSON.parse(seo.jsonLd)['@graph'] as { '@type': string }[]).map((node) => node['@type']);
  assert.deepEqual(types, ['WebSite', 'WebPage']);
});

test('the social image matches the size the tags advertise', () => {
  const png = readFileSync(new URL('../public/og.png', import.meta.url));
  assert.equal(png.readUInt32BE(16), OG_IMAGE.width);
  assert.equal(png.readUInt32BE(20), OG_IMAGE.height);
});

test('the site layout publishes the social and canonical tags', () => {
  const layout = readFileSync(new URL('./layouts/Site.astro', import.meta.url), 'utf8');
  for (const tag of [
    'rel="canonical"',
    'property="og:image"',
    'property="og:title"',
    'property="og:description"',
    'name="twitter:card"',
    'type="application/ld+json"',
  ]) {
    assert.ok(layout.includes(tag), tag);
  }
});
