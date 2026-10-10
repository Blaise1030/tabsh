// Conservative path-to-spec selection for ordinary CI changes. Unknown and
// shared paths run the full suite. Keep feature mappings in step with new specs.
import { appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const smoke = 'e2e/smoke.spec.ts';
const featureRules = [
  {
    paths: [/^web\/src\/app\/board\//, /^src\/board\//],
    specs: ['board', 'dialogs', 'navigation', 'providers', 'tabs'],
  },
  {
    paths: [/^web\/src\/app\/explorer\//, /^src\/files\//],
    specs: [
      'board', 'editor-comments', 'explorer', 'explorer-actions',
      'explorer-chrome', 'explorer-follow', 'explorer-live',
      'explorer-search', 'navigation', 'pane',
    ],
  },
  {
    paths: [/^web\/src\/app\/files\//, /^src\/upload\.rs$/],
    specs: ['editor-comments', 'explorer', 'navigation', 'pane'],
  },
  {
    paths: [/^web\/src\/app\/palette\//],
    specs: [
      'board', 'dialogs', 'navigation', 'palette', 'providers',
      'tab-groups', 'tooltips', 'typing-sound',
    ],
  },
  {
    paths: [/^web\/src\/app\/sound\//],
    specs: ['typing-sound'],
  },
];

const generatedApp = (path) => path === 'src/app.html' || path.startsWith('src/app-assets/');
const noAppE2e = (path) =>
  path === 'README.md' || path === 'CHANGELOG.md' || path.startsWith('docs/') ||
  path.startsWith('web/src/demo/') || path.startsWith('web/src/pages/demo/') ||
  path === 'web/src/pages/index.astro' || path === 'web/src/pages/changelog.astro' ||
  path === 'web/src/pages/docs.astro' || path === 'web/src/layouts/Site.astro' ||
  path === 'web/src/site.ts';

export function missingEmbeddedAssets(paths) {
  const appSource = paths.some((path) =>
    ((path.startsWith('web/src/app/') && !/\.(?:test|d)\.ts$/.test(path)) ||
      path === 'web/src/pages/app/index.astro' || path === 'web/src/styles/app.css'));
  return appSource && !paths.some(generatedApp);
}

export function selectE2e(paths) {
  if (paths.length === 0) return { mode: 'full', specs: [] };

  // A release PR changes only version metadata and the changelog. The release
  // workflow runs the full suite on the resulting main commit before publish.
  const releaseMetadata = new Set(['package.json', 'Cargo.toml', 'Cargo.lock', 'CHANGELOG.md']);
  if (paths.includes('package.json') && paths.every((path) => releaseMetadata.has(path))) {
    return { mode: 'selected', specs: [smoke] };
  }

  const specs = new Set([smoke]);
  let mappedAppSource = false;
  let generated = false;
  for (const path of paths) {
    if (generatedApp(path)) {
      generated = true;
      continue;
    }
    if (noAppE2e(path)) {
      continue;
    }
    if (/^web\/e2e\/[^/]+\.spec\.ts$/.test(path)) {
      specs.add(`e2e/${path.slice('web/e2e/'.length)}`);
      mappedAppSource = true;
      continue;
    }
    const rule = featureRules.find(({ paths: patterns }) => patterns.some((pattern) => pattern.test(path)));
    if (!rule) return { mode: 'full', specs: [] };
    for (const name of rule.specs) specs.add(`e2e/${name}.spec.ts`);
    mappedAppSource = true;
  }
  // A generated bundle with no mapped app source may have changed by hand.
  if (generated && !mappedAppSource) return { mode: 'full', specs: [] };
  return { mode: 'selected', specs: [...specs].sort() };
}

function run() {
  const base = process.env.E2E_BASE;
  const head = process.env.E2E_HEAD;
  let paths = [];
  if (base && head && !/^0+$/.test(base)) {
    try {
      paths = execFileSync('git', ['diff', '--no-renames', '--name-only', '-z', base, head], {
        encoding: 'utf8',
      }).split('\0').filter(Boolean);
    } catch (error) {
      console.warn(`Could not inspect changed files: ${error.message}; running full e2e suite.`);
    }
  }
  if (missingEmbeddedAssets(paths)) {
    throw new Error('App source changed without src/app.html or src/app-assets. Run npm run build in web/ and commit the embedded app before e2e.');
  }
  const result = selectE2e(paths);
  console.log(`Changed files: ${paths.length ? paths.join(', ') : '(unavailable)'}`);
  console.log(`E2E selection: ${result.mode === 'full' ? 'full suite' : result.specs.join(', ')}`);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `specs=${result.specs.join(' ')}\n`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) run();
