// Starts a real tabsh daemon for the e2e specs: its own port, its own throw-
// away state dir, stopped and cleaned up afterwards. No playwright here, so
// the same lifecycle could drive other tools. See web/e2e/README.md.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Daemon {
  // Where this daemon listens, e.g. http://127.0.0.1:41234.
  baseUrl: string;
  // The pairing token, read from the state dir's `token` file.
  token: string;
  // Stops the daemon and deletes its state dir.
  cleanup: () => Promise<void>;
}

// The binary CI builds with `cargo build --locked`; TABSH_BIN overrides it.
const defaultBin = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../target/debug/tabsh');

// A port the kernel confirms is free right now. The daemon binds it straight
// after; on loopback that gap is a tolerable race for a test harness.
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as net.AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

export async function startDaemon(): Promise<Daemon> {
  const bin = process.env.TABSH_BIN ?? defaultBin;
  const dir = await mkdtemp(path.join(tmpdir(), 'tabsh-e2e-'));
  const port = await freePort();
  const child = spawn(bin, [String(port)], {
    env: {
      ...process.env,
      TABSH_DB: path.join(dir, 'state.db'),
      TABSH_NO_BROWSER: '1', // the browser is playwright's to open, not the daemon's
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout!.on('data', (chunk) => (stdout += chunk));
  child.stderr!.on('data', (chunk) => (stderr += chunk));

  // The daemon prints "tabsh listening on …" only once the port is bound, so
  // wait for that line rather than polling the port ourselves.
  await new Promise<void>((resolve, reject) => {
    const fail = (why: string) => reject(new Error(`${why}\nstdout:\n${stdout}\nstderr:\n${stderr}`));
    const timer = setTimeout(() => fail(`daemon did not start on port ${port} within 30s`), 30_000);
    const check = () => {
      if (/tabsh listening on http:\/\/127\.0\.0\.1:\d+/.test(stdout)) {
        clearTimeout(timer);
        resolve();
      }
    };
    child.on('error', (e) => fail(`could not start the daemon (${bin}): ${e.message}`));
    child.on('exit', (code, signal) => fail(`daemon exited early (${signal ?? code})`));
    child.stdout!.on('data', check);
    check();
  }).catch(async (e: unknown) => {
    child.kill('SIGKILL');
    await rm(dir, { recursive: true, force: true });
    throw e;
  });

  // The token file sits beside the database, written before "listening".
  const token = (await readFile(path.join(dir, 'token'), 'utf8')).trim();

  const cleanup = async () => {
    // SIGTERM is the daemon's own shutdown path: it flushes state and exits.
    child.kill('SIGTERM');
    await new Promise<void>((resolve) => {
      child.on('exit', resolve);
      setTimeout(() => {
        child.kill('SIGKILL');
        resolve();
      }, 5000).unref();
    });
    await rm(dir, { recursive: true, force: true });
  };

  return { baseUrl: `http://127.0.0.1:${port}`, token, cleanup };
}
