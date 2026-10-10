import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { missingEmbeddedAssets, selectE2e } from './select-e2e.mjs';

test('selects the changed feature and always includes smoke', () => {
  assert.deepEqual(selectE2e(['web/src/app/board/model.ts']), {
    mode: 'selected',
    specs: ['e2e/board.spec.ts', 'e2e/dialogs.spec.ts', 'e2e/navigation.spec.ts', 'e2e/providers.spec.ts', 'e2e/smoke.spec.ts', 'e2e/tabs.spec.ts'],
  });
});

test('combines feature selections without duplicates', () => {
  assert.deepEqual(selectE2e(['web/src/app/board/model.ts', 'web/src/app/palette/pages.ts']), {
    mode: 'selected',
    specs: [
      'e2e/board.spec.ts', 'e2e/dialogs.spec.ts', 'e2e/navigation.spec.ts',
      'e2e/palette.spec.ts', 'e2e/providers.spec.ts', 'e2e/smoke.spec.ts',
      'e2e/tab-groups.spec.ts', 'e2e/tabs.spec.ts', 'e2e/tooltips.spec.ts',
      'e2e/typing-sound.spec.ts',
    ],
  });
});

test('explorer changes include file-opening flows', () => {
  const result = selectE2e(['web/src/app/explorer/view.ts']);
  assert.equal(result.mode, 'selected');
  assert.ok(result.specs.includes('e2e/editor-comments.spec.ts'));
  assert.ok(result.specs.includes('e2e/pane.spec.ts'));
});

test('a changed spec runs itself', () => {
  assert.deepEqual(selectE2e(['web/e2e/editor-comments.spec.ts']), {
    mode: 'selected',
    specs: ['e2e/editor-comments.spec.ts', 'e2e/smoke.spec.ts'],
  });
});

test('docs and landing-only changes run smoke', () => {
  assert.deepEqual(selectE2e(['README.md', 'web/src/pages/index.astro', 'web/src/pages/docs.astro', 'web/src/layouts/Site.astro']), {
    mode: 'selected',
    specs: ['e2e/smoke.spec.ts'],
  });
});

test('release metadata alone runs smoke in CI; release workflow runs full e2e', () => {
  assert.deepEqual(selectE2e(['package.json', 'Cargo.toml', 'Cargo.lock', 'CHANGELOG.md']), {
    mode: 'selected',
    specs: ['e2e/smoke.spec.ts'],
  });
  assert.deepEqual(selectE2e(['Cargo.toml']), { mode: 'full', specs: [] });
  assert.deepEqual(selectE2e(['package.json', 'Cargo.toml', 'src/main.rs']), { mode: 'full', specs: [] });
});

test('shared app changes run the full suite', () => {
  assert.deepEqual(selectE2e(['web/src/app/main.ts']), { mode: 'full', specs: [] });
  assert.deepEqual(selectE2e(['web/src/app/nav/router.ts']), { mode: 'full', specs: [] });
  assert.deepEqual(selectE2e(['web/e2e/fixture.ts']), { mode: 'full', specs: [] });
});

test('unknown changes and empty diffs run the full suite', () => {
  assert.deepEqual(selectE2e(['src/new-feature.rs']), { mode: 'full', specs: [] });
  assert.deepEqual(selectE2e([]), { mode: 'full', specs: [] });
});

test('every mapped spec exists', () => {
  const sources = [
    'web/src/app/board/model.ts', 'src/board/mod.rs',
    'web/src/app/explorer/view.ts', 'src/files/tree.rs',
    'web/src/app/files/pane.ts', 'src/upload.rs',
    'web/src/app/palette/palette.ts', 'web/src/app/sound/typing.ts',
  ];
  const root = fileURLToPath(new URL('../../', import.meta.url));
  for (const source of sources) {
    const result = selectE2e([source]);
    assert.equal(result.mode, 'selected');
    for (const spec of result.specs) {
      assert.ok(existsSync(path.join(root, 'web', spec)), `${source} maps to missing ${spec}`);
    }
  }
});

test('generated app assets do not broaden a mapped source change', () => {
  assert.deepEqual(selectE2e(['web/src/app/board/model.ts', 'src/app.html', 'src/app-assets/main.hash.js']), {
    mode: 'selected',
    specs: ['e2e/board.spec.ts', 'e2e/dialogs.spec.ts', 'e2e/navigation.spec.ts', 'e2e/providers.spec.ts', 'e2e/smoke.spec.ts', 'e2e/tabs.spec.ts'],
  });
  assert.deepEqual(selectE2e(['src/app.html']), { mode: 'full', specs: [] });
  assert.deepEqual(selectE2e(['README.md', 'src/app.html']), { mode: 'full', specs: [] });
});

test('app source changes need an updated embedded bundle for meaningful e2e', () => {
  assert.equal(missingEmbeddedAssets(['web/src/app/board/model.ts']), true);
  assert.equal(missingEmbeddedAssets(['web/src/pages/app/index.astro']), true);
  assert.equal(missingEmbeddedAssets(['web/src/styles/app.css']), true);
  assert.equal(missingEmbeddedAssets(['web/src/app/board/model.ts', 'src/app-assets/main.hash.js']), false);
  assert.equal(missingEmbeddedAssets(['web/src/app/board/model.test.ts']), false);
  assert.equal(missingEmbeddedAssets(['src/board/mod.rs']), false);
});
