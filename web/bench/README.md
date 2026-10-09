# bench — busy tabs stay responsive

A repeatable benchmark for the busy-tabs work ([#71](https://github.com/Blaise1030/tabsh/issues/71),
[#82](https://github.com/Blaise1030/tabsh/issues/82)), so each slice shows
before/after numbers instead of "feels faster". It reuses the e2e daemon
fixture (`../e2e/daemon.ts`, `../e2e/fixture.ts`): its own daemon, temp state
dir and free port. It never touches another tabsh on the machine.

It has its own Playwright config (`playwright.bench.config.ts`, `testDir:
bench`), so `npm run test:e2e` and CI never run it.

## Running

```sh
cargo build --release --locked       # at the repo root: target/release/tabsh
cd web
npx playwright install chromium      # once per machine
npm run bench                        # all scenarios, ~2-3 minutes
npm run bench -- -g "flush"          # one scenario (Playwright --grep)
```

Use a **release** build: debug numbers are dominated by the unoptimised
daemon. `TABSH_BIN` picks the binary (default `../target/release/tabsh`), and
since the app page is embedded in the binary, a run measures daemon and app
together. Shells run as `$BENCH_SHELL -l` (default `/bin/sh`), so your own
dotfiles don't time in.

Each run writes `bench/results/<label>-<time>.json` (or `BENCH_OUT`) and a copy
at `bench/results/latest.json`. `BENCH_LABEL` names it. Results are gitignored
except `bench/results/baseline.json`, the committed baseline for
`features/busy-tabs-responsive`.

Numbers move with machine load (the JSON records `loadavg`): compare runs made
back to back on a quiet machine, and trust medians more than p95/max.

## Scenarios

| Scenario | Slice | What happens | Metrics |
|---|---|---|---|
| `background-flood` | 1 | `BENCH_BG_TABS` parked tabs print for `BENCH_BG_SECONDS` while the user types in the active tab, switches to a quiet tab and back, then into a flooding tab and back | `keystrokeEchoMs` (keydown → echo arrived and a frame painted), `tabSwitchQuietMs`, `tabSwitchToBusyMs` (click → replay arrived and painted), `longTaskTotalMs`/`longTaskMaxMs`, `maxFrameGapMs`, `unreadMs` (flood start → a parked tab shows `.unread`) and `unreadSeen` (share of runs where it did) |
| `active-flood` | 2 | The visible tab `cat`s `BENCH_BURST_BYTES`; `BENCH_BURST_DELAY_MS` in, open the board; a second burst, switch tab and back | `boardOpenMs`, `tabSwitchMs`, `contentCompleteMs` (Enter → the burst's closing title is on the tab), long tasks, `maxFrameGapMs` |
| `flush-contention` | 3 | `BENCH_FLUSH_SESSIONS` shells keep full (512KB) scrollback dirty for `BENCH_FLUSH_SECONDS` (several 2s flushes) | `patchStatusMs` (`PATCH /api/sessions/{id}/status`), `listSessionsMs` (`GET /api/sessions`), back to back |
| `attach-under-load` | 4 | A shell prints `BENCH_ATTACH_BYTES` twice: once alone, once while Node reattaches over and over | `attachReplayMs` (WS open → replay received), `throughputQuietMBps`, `throughputUnderAttachMBps`, `throughputRatio` (1.0 = attaches cost the producer nothing) |
| `spawn-burst` | 5 | `BENCH_SPAWN_TABS` tabs created and attached at once (each attach spawns a shell) while `/api/settings` is polled | `settingsMs`, `tabUsableMs` (burst start → a typed command's output arrives), `allTabsUsableMs` |

Browser scenarios time real UI interactions in the daemon's own app page: an
init script (`installProbe` in `lib.ts`) records `PerformanceObserver('longtask')`
entries, frame times, input event timestamps (which include queueing delay)
and every terminal socket's messages. Daemon scenarios time real HTTP/WS calls
from Node. Output comes from `cat` of prepared base64 files, so the producer
itself is never the bottleneck.

Every scenario repeats `BENCH_RUNS` times (default 5) on a clean session list;
each metric reports the median, p95 and max of all its samples (one per run,
or one per keystroke / request / attach where there are many).

Knobs, with defaults: `BENCH_RUNS=5`, `BENCH_BG_TABS=4`, `BENCH_BG_SECONDS=6`,
`BENCH_FLOOD_CHUNK=65536`, `BENCH_KEYSTROKES=20`, `BENCH_BURST_BYTES=2000000`,
`BENCH_BURST_DELAY_MS=300`, `BENCH_FLUSH_SESSIONS=6`, `BENCH_FLUSH_SECONDS=7`,
`BENCH_ATTACH_BYTES=64000000`, `BENCH_SPAWN_TABS=8`.

## Comparing a slice

Two result files:

```sh
npm run bench:compare -- bench/results/baseline.json bench/results/latest.json
```

Or two binaries, benchmarked back to back (best: same machine state):

```sh
# build the slice in its own worktree
(cd ../.worktrees/<slice> && cargo build --release --locked)
npm run bench:compare -- --bin ../target/release/tabsh --bin ../.worktrees/<slice>/target/release/tabsh
```

Either prints a markdown table (median and p95, with Δ and better/worse)
ready to paste into the slice's PR. For just the slice's scenario, run it
once per binary and compare the two files:

```sh
TABSH_BIN=../target/release/tabsh BENCH_OUT=/tmp/before.json npm run bench -- -g flush
TABSH_BIN=../.worktrees/<slice>/target/release/tabsh BENCH_OUT=/tmp/after.json npm run bench -- -g flush
npm run bench:compare -- /tmp/before.json /tmp/after.json
```
