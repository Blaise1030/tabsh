// Prints a markdown before/after table of two benchmark results, ready to
// paste into a PR. See web/bench/README.md.
//
//   node bench/compare.ts before.json after.json
//   node bench/compare.ts --bin ../target/release/tabsh --bin ../.worktrees/x/target/release/tabsh
//
// With --bin, each binary is benchmarked in turn (`npm run bench` with
// TABSH_BIN) and the two fresh results are compared. Env knobs (BENCH_RUNS,
// …) apply to both runs.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Metric, Results } from './lib.ts';

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function usage(): never {
  console.error(
    'usage: node bench/compare.ts <before.json> <after.json>\n       node bench/compare.ts --bin <before> --bin <after>',
  );
  process.exit(2);
}

function bench(bin: string, which: string): string {
  const out = path.join(web, 'bench', 'results', `compare-${which}-${Date.now()}.json`);
  console.error(`\n== benchmarking ${which}: ${bin}`);
  const r = spawnSync('npx', ['playwright', 'test', '-c', 'playwright.bench.config.ts'], {
    cwd: web,
    stdio: ['ignore', 2, 'inherit'], // its report to stderr: stdout is the table
    env: {
      ...process.env,
      TABSH_BIN: path.resolve(bin),
      BENCH_OUT: out,
      BENCH_LABEL: process.env.BENCH_LABEL ?? which,
    },
  });
  if (r.status !== 0) {
    console.error(`benchmark of ${bin} failed (${r.status})`);
    process.exit(1);
  }
  return out;
}

const fmt = (v: number | null, unit: string) => {
  if (v === null) return 'n/a';
  const n = Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2);
  return unit === 'ms' ? `${n} ms` : unit === 'ratio' || unit === 'count' ? n : `${n} ${unit}`;
};

// Change from a to b in percent, and whether that is better, worse or noise (<5%).
function delta(a: number | null, b: number | null, better: Metric['better']): string {
  if (a === null || b === null) return 'n/a';
  if (a === b) return '0%';
  if (a === 0) return better === (b > 0 ? 'higher' : 'lower') ? 'better' : 'worse';
  const pct = ((b - a) / Math.abs(a)) * 100;
  const sign = pct > 0 ? '+' : '';
  const verdict = Math.abs(pct) < 5 ? '≈' : pct < 0 === (better === 'lower') ? 'better' : 'worse';
  return `${sign}${pct.toFixed(0)}% ${verdict}`;
}

export function table(before: Results, after: Results): string {
  const lines = [
    `Before: \`${before.meta.label}\` (${before.meta.binSha256}, ${before.meta.knobs.runs} runs) · After: \`${after.meta.label}\` (${after.meta.binSha256}, ${after.meta.knobs.runs} runs)`,
    '',
    '| Scenario | Metric | Before median | After median | Δ median | Before p95 | After p95 | Δ p95 |',
    '|---|---|---|---|---|---|---|---|',
  ];
  const scenarios = [...new Set([...Object.keys(before.scenarios), ...Object.keys(after.scenarios)])];
  for (const sc of scenarios) {
    const bm = before.scenarios[sc] ?? {};
    const am = after.scenarios[sc] ?? {};
    for (const name of [...new Set([...Object.keys(bm), ...Object.keys(am)])]) {
      const b = bm[name];
      const a = am[name];
      const m = (b ?? a) as Metric;
      const better = m.better === 'lower' ? '↓' : '↑';
      lines.push(
        `| ${sc} | ${name} ${better} | ${fmt(b?.median ?? null, m.unit)} | ${fmt(a?.median ?? null, m.unit)} | ${delta(
          b?.median ?? null,
          a?.median ?? null,
          m.better,
        )} | ${fmt(b?.p95 ?? null, m.unit)} | ${fmt(a?.p95 ?? null, m.unit)} | ${delta(b?.p95 ?? null, a?.p95 ?? null, m.better)} |`,
      );
    }
  }
  lines.push('', '↓ lower is better, ↑ higher is better; ≈ is a change under 5%.');
  return lines.join('\n');
}

const args = process.argv.slice(2);
let files: string[];
if (args[0] === '--bin') {
  const bins = args.filter((_, i) => args[i - 1] === '--bin');
  if (bins.length !== 2) usage();
  files = [bench(bins[0], 'before'), bench(bins[1], 'after')];
} else {
  if (args.length !== 2) usage();
  files = args;
}
const [before, after] = files.map((f) => JSON.parse(readFileSync(f, 'utf8')) as Results);
console.log(table(before, after));
