# Open on Another Device Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From tabsh on the Mac, turn on sharing over Tailscale and pair a phone with one QR scan, using a per-device token you can revoke.

**Architecture:** A new `remote/` feature on the daemon owns the `remote` and `devices` tables, the in-memory sharing state, and a second listener bound to the Tailscale IPv4 address. The guard learns the caller's peer address and credential: every non-loopback peer needs a token on every route except the page and its assets. A new `remote/` folder in the app holds the palette's dialog, with the QR code drawn as SVG elements by a lazily imported encoder.

**Tech Stack:** Rust 2024 (axum 0.8, rusqlite, tokio, libc), Astro + TypeScript + VanJS, `uqr`, `node --test`, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-12-open-on-another-device-design.md`

## Global Constraints

- Read `docs/architecture.md` first; its rules (routes per feature, `pub(crate)` visibility, tests in the owning file, no markup strings, lazy heavy imports) apply to every task.
- Sharing is off by default. Off means no listener outside loopback, and every non-loopback peer is refused (403).
- A Tailscale address is an IPv4 in `100.64.0.0/10` on an interface whose name starts with `utun` or equals `tailscale0`. Nothing else counts.
- The second listener binds `<address>:<port>`, the daemon's own port, and serves `state::router` with `into_make_service_with_connect_info::<SocketAddr>()`.
- Tokens: `auth::random_hex(32)`, compared with `auth::token_eq`. A device token is returned once, at minting, inside `url`; no list or GET returns it.
- Link format: `http://<address>:<port>/app/#token=<token>` (IPv6 addresses in brackets).
- Device tokens get 403 on every `/api/remote*` route.
- `TABSH_REMOTE_ADDRESS` (an IP) replaces Tailscale detection. It exists for tests; document it in `docs/architecture.md` only.
- Copy, verbatim: dialog title “Open on another device”; switch “Share over Tailscale”; button “Add device”; default name “iPhone”; “Copy link”; “Revoke”; “Not used yet”; no Tailscale: “Install Tailscale on this Mac and the other device, sign both in to the same account, then reopen this.”; device token: “Open this on the Mac running tabsh.”; fixed host: “tabsh already listens on <host>. Sharing is set by HOST.”
- Checks before each commit: `cargo fmt --check`, `cargo clippy --all-targets --locked -- -D warnings`, `cargo test --locked`. App tasks also run, in `web/`: `npm run check`, `npm run lint`, `npm test`, `npm run build` (commit `src/app.html` and `src/app-assets/`).

## Review Focus

- **A keep-alive connection from a phone after sharing is turned off** should get 403 on its next request. Tested in Task 2 (`sharing_off_refuses_remote_peers`).
- **A request reaching the guard without a peer address** (a router built without connect info) should be refused, never treated as loopback. Tested in Task 2 (`missing_peer_is_refused`).
- **Revoking a device while it has a terminal open** should close that socket at once, not at its next request. Tested in Task 5 (`revoke_closes_the_devices_socket`).
- **Carrier NAT on Wi-Fi handing out a 100.64.x.x address on `en0`** must never be shared. Tested in Task 3 (`picks_only_tailscale_interfaces`).
- **Tailscale not up yet when the daemon starts with sharing on** should start sharing once it comes up, without a restart. Tested in Task 3 (`start_waits_for_an_address`).

---

### Task 1: Device registry and sharing state

**Files:**
- Create: `src/remote/mod.rs`
- Modify: `src/main.rs` (`mod remote;`, build `Remote` and `port` into `AppState`)
- Modify: `src/state.rs` (`AppState` fields)
- Modify: `src/sessions/store.rs:16-31` (create tables)
- Modify: `src/auth.rs` (the `Credential` type)
- Modify: `src/test_support.rs` (new fields)

**Interfaces:**
- Produces, in `auth.rs`: `#[derive(Clone, Debug, PartialEq)] pub(crate) enum Credential { Main, Device(String) }` (the device's id).
- Produces, in `remote/mod.rs`:
  - `pub(crate) struct Remote { enabled: AtomicBool, devices: Mutex<HashMap<String, String>> /* token → id */, listener: Mutex<Option<tokio::task::AbortHandle>>, error: Mutex<Option<String>>, pub(crate) closed: broadcast::Sender<Closed> }`
  - `#[derive(Clone, Debug)] pub(crate) enum Closed { Device(String), All }`
  - `pub(crate) fn load(conn: &Connection) -> Result<Remote, BoxError>`: reads `enabled` and every device into memory.
  - `pub(crate) fn credential(st: &AppState, token: &str) -> Option<Credential>`: `Main` when it equals `st.token`, `Device(id)` when it matches a device token, else `None`. Compares with `token_eq`. Updates `last_seen` at most once a minute per device.
  - `pub(crate) fn mint(st: &AppState, name: &str) -> Result<(String, String), BoxError>`: returns `(id, token)`; name trimmed, empty becomes “iPhone”, at most 60 chars.
  - `pub(crate) fn revoke(st: &AppState, id: &str) -> Result<bool, BoxError>`: deletes the row, drops it from memory, sends `Closed::Device(id)`; `false` when no such device.
  - `pub(crate) fn set_enabled(st: &AppState, on: bool) -> Result<(), BoxError>`: saves and mirrors the flag; turning off sends `Closed::All`. (The listener is Task 3's.)
  - `pub(crate) fn is_enabled(st: &AppState) -> bool`.
  - `#[derive(Serialize)] pub(crate) struct DeviceInfo { id, name, created: i64, last_seen: Option<i64> }` and `pub(crate) fn list(st: &AppState) -> Result<Vec<DeviceInfo>, BoxError>`, oldest first.
- Produces, on `AppState`: `pub(crate) remote: Arc<remote::Remote>`, `pub(crate) port: u16`.

- [ ] **Step 1: Write the failing tests in `remote/mod.rs`**

```rust
#[test]
fn a_minted_token_is_a_device_credential() {
    let st = test_state();
    let (id, token) = mint(&st, " Pixel ").unwrap();
    assert_eq!(token.len(), 64);
    assert_eq!(credential(&st, &token), Some(Credential::Device(id)));
    assert_eq!(credential(&st, "t0k3n"), Some(Credential::Main));
    assert_eq!(credential(&st, "nope"), None);
    assert_eq!(list(&st).unwrap()[0].name, "Pixel");
}

#[test]
fn an_empty_name_is_iphone() { /* mint(&st, "  ") → list name "iPhone" */ }

#[test]
fn the_list_never_holds_a_token() {
    // serde_json::to_string(&list(&st)) does not contain the minted token
}

#[test]
fn revoke_drops_the_credential_and_says_so() {
    // subscribe to st.remote.closed; revoke(&st, &id) == true;
    // credential(&st, &token) == None; rx.try_recv() is Closed::Device(id);
    // revoke(&st, &id) again == false
}

#[test]
fn enabled_and_devices_survive_reopening() {
    // open_db on a file under scratch(); set_enabled(true) and mint;
    // drop; load(&open_db(same path)) has enabled == true and the token
}
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cargo test --locked remote::`
Expected: FAIL (module doesn't exist).

- [ ] **Step 3: Implement**

In `open_db`:

```sql
CREATE TABLE IF NOT EXISTS remote (
    id      INTEGER PRIMARY KEY CHECK (id = 1),
    enabled INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS devices (
    id        TEXT PRIMARY KEY,
    name      TEXT NOT NULL,
    token     TEXT NOT NULL UNIQUE,
    created   INTEGER NOT NULL DEFAULT (unixepoch()),
    last_seen INTEGER
);
```

A device id is `random_hex(8)`. In `main.rs`, call `remote::load` on the opened db before building `AppState`, and set `port` from the parsed port. `test_state` uses `remote::load` on its in-memory db and `port: 7681`.

- [ ] **Step 4: Run the tests**

Run: `cargo test --locked`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/remote/mod.rs src/main.rs src/state.rs src/sessions/store.rs src/auth.rs src/test_support.rs
git commit -m "feat(remote): device tokens and the sharing flag"
```

---

### Task 2: The guard knows the peer and the credential

**Files:**
- Modify: `src/web/guard.rs`
- Modify: `src/state.rs` (`every_route_is_guarded` sends a loopback `ConnectInfo`)
- Modify: `docs/architecture.md` (security invariants)

**Interfaces:**
- Consumes: `remote::credential`, `remote::is_enabled`, `auth::Credential`.
- Produces: the guard inserts `Credential` as a request extension on every request it lets through with a token; handlers read it with `Option<Extension<Credential>>`.

Rules, in order: Host check (unchanged). No `ConnectInfo<SocketAddr>` extension → 403. Non-loopback peer: sharing off → 403; GET or HEAD of `/`, `/open`, `/app`, `/app/`, `/_astro/{name}` (as `is_public_asset`), `/sounds/{*path}` → pass; no credential → 401. Any peer: a `Device` credential on a path starting `/api/remote` → 403. Then the existing Origin logic, with “the token” meaning any credential.

- [ ] **Step 1: Write the failing tests in `guard.rs`**

A helper `send(st, method, path, peer: Option<[u8; 4]>, origin: Option<&str>, token: Option<&str>) -> StatusCode` that runs `state::router` with `oneshot`, Host `100.64.0.1:7681` for a non-loopback peer and `127.0.0.1:7681` for loopback.

```rust
#[tokio::test]
async fn remote_peers_need_a_token_on_every_route() {
    // set_enabled(&st, true); peer [100, 64, 0, 1]
    for (m, p) in [(POST, "/api/sessions"), (PATCH, "/api/sessions/x/status"), (GET, "/ws?id=x"),
                   (GET, "/api/board/events"), (GET, "/api/settings")] {
        assert_eq!(send(&st, m, p, peer, None, None).await, UNAUTHORIZED);
        assert_eq!(send(&st, m, p, peer, Some("http://100.64.0.1:7681"), None).await, UNAUTHORIZED);
    }
}

#[tokio::test]
async fn remote_peers_get_the_page_without_a_token() {
    // GET /app/ → 200; GET /_astro/<first_asset_name()> → 200; GET /open → 307 to "/app/" (no token)
}

#[tokio::test]
async fn sharing_off_refuses_remote_peers() {
    // enabled false; GET /app/ and GET /api/sessions with the main token → 403
}

#[tokio::test]
async fn missing_peer_is_refused() { /* no ConnectInfo, loopback Host → 403 */ }

#[tokio::test]
async fn a_device_token_works_but_not_on_remote_routes() {
    // mint; GET /api/sessions with Bearer device token from the remote peer → 200;
    // GET /api/remote with it → 403 (from loopback too)
}

#[tokio::test]
async fn a_revoked_token_is_refused() { /* revoke, then GET /api/sessions → 401 */ }
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cargo test --locked web::guard`
Expected: FAIL. (`/api/remote` answers 404 until Task 4; that test asserts 403, which the guard answers before routing.)

- [ ] **Step 3: Implement the rules in `guard`**

Add `.extension(ConnectInfo(SocketAddr::from(([127, 0, 0, 1], 50000))))` to every request in `every_route_is_guarded`, and keep its assertions.

- [ ] **Step 4: Update `docs/architecture.md`'s security invariants**

Under **Guard**, add: “From a non-loopback peer, every route needs a token (the main one or a device's), with or without an Origin, except GET or HEAD of the page (`/`, `/open`, `/app`, `/app/`) and its assets (`/_astro/{name}`, `/sounds/…`). With sharing off, a non-loopback peer is refused. A request without a peer address is refused.” and “A device token can't reach `/api/remote*`.”

- [ ] **Step 5: Run the tests**

Run: `cargo test --locked`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/web/guard.rs src/state.rs docs/architecture.md
git commit -m "feat(guard): remote peers need a token on every route"
```

---

### Task 3: The Tailscale address and the second listener

**Files:**
- Create: `src/remote/listen.rs`
- Modify: `src/main.rs` (start sharing at startup when enabled)

**Interfaces:**
- Consumes: `Remote`, `state::router`.
- Produces:
  - `pub(super) fn pick_tailscale(addrs: &[(String, Ipv4Addr)]) -> Option<Ipv4Addr>`: pure.
  - `fn interface_v4s() -> Vec<(String, Ipv4Addr)>`: `libc::getifaddrs`, IPv4 only, freed with `freeifaddrs`.
  - `pub(crate) fn address() -> Option<IpAddr>`: `TABSH_REMOTE_ADDRESS` when set and parsable, else `pick_tailscale(&interface_v4s())`.
  - `pub(crate) async fn start(st: AppState) -> Result<SocketAddr, String>`: binds `address():st.port` and spawns `axum::serve` of `state::router(st.clone())` with connect info; stores the task's `AbortHandle` in `remote.listener` and clears `remote.error`. No address → `Err("No Tailscale address")`. A bind error → `Err(<error text>)`, also stored in `remote.error`. Already running → `Ok` of its address.
  - `pub(crate) fn stop(st: &AppState)`: aborts the handle.
  - `pub(crate) fn keep_trying(st: AppState)`: spawns a task that calls `start` every 30 seconds until it succeeds or sharing is off.

- [ ] **Step 1: Write the failing tests in `listen.rs`**

```rust
#[test]
fn picks_only_tailscale_interfaces() {
    let a = |n: &str, ip: [u8; 4]| (n.to_string(), Ipv4Addr::from(ip));
    assert_eq!(pick_tailscale(&[a("en0", [100, 64, 1, 2]), a("utun4", [100, 86, 117, 9])]),
               Some(Ipv4Addr::new(100, 86, 117, 9)));
    assert_eq!(pick_tailscale(&[a("tailscale0", [100, 127, 255, 1])]), Some(Ipv4Addr::new(100, 127, 255, 1)));
    assert_eq!(pick_tailscale(&[a("en0", [100, 64, 1, 2])]), None);
    assert_eq!(pick_tailscale(&[a("utun3", [10, 0, 0, 1]), a("utun4", [100, 128, 0, 1])]), None);
}

#[tokio::test]
async fn start_serves_and_stop_stops() {
    // TABSH_REMOTE_ADDRESS is process-wide: this test sets it to "127.0.0.1",
    // with st.port from a free port; start → Ok; a TCP connect succeeds; stop;
    // after 100 ms a connect fails
}

#[tokio::test]
async fn start_waits_for_an_address() {
    // with no address, start → Err("No Tailscale address") and remote.error is Some;
    // keep_trying with a 50 ms interval under cfg(test) picks the address up once set
}
```

Make the 30-second interval a `const RETRY: Duration` that is 50 ms under `cfg(test)`. Run the two env-touching tests serially behind one `static ENV: Mutex<()>`.

- [ ] **Step 2: Run them to verify they fail**

Run: `cargo test --locked remote::listen`
Expected: FAIL.

- [ ] **Step 3: Implement, then in `main.rs` after the loopback bind: `if remote::is_enabled(&state) { remote::listen::keep_trying(state.clone()) }`**

`keep_trying` tries once at once, then every `RETRY`. Print `tabsh sharing on http://<addr>` when it starts.

- [ ] **Step 4: Run the tests**

Run: `cargo test --locked`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/remote/listen.rs src/remote/mod.rs src/main.rs
git commit -m "feat(remote): listen on the Tailscale address"
```

---

### Task 4: The `/api/remote` routes

**Files:**
- Modify: `src/remote/mod.rs` (`routes()`)
- Modify: `src/state.rs` (merge; add to `every_route_is_guarded`)
- Modify: `src/main.rs` (keep the `HOST` value for `host`)

**Interfaces:**
- Consumes: Task 1's registry, Task 3's `address`, `start`, `stop`.
- Produces: the four routes, the API the app's `remote/api.ts` calls:
  - `GET /api/remote` → `{enabled: bool, address: string|null, port: number, host: string|null, error: string|null, devices: DeviceInfo[]}`
  - `PUT /api/remote` `{enabled: bool}` → the same body as GET. On: `set_enabled(true)` then `start`; if `start` fails, `set_enabled(false)` and answer 200 with `error` set. Off: `set_enabled(false)` and `stop`. With `host` set, PUT → 409.
  - `POST /api/remote/devices` `{name: string}` → `{id, name, url}`. 409 when sharing is off or there is no address.
  - `DELETE /api/remote/devices/{id}` → 204, or 404.
- `AppState` gains `pub(crate) host: Option<Arc<str>>`: the `HOST` value when it doesn't parse as a loopback IP; `None` by default and in `test_state`.

- [ ] **Step 1: Write the failing tests in `remote/mod.rs`**

```rust
#[tokio::test]
async fn get_reports_off_with_no_devices() { /* {enabled:false, devices:[]} */ }

#[tokio::test]
async fn add_device_returns_the_link_once() {
    // TABSH_REMOTE_ADDRESS=127.0.0.1 (shared ENV lock), free port; PUT {enabled:true};
    // POST {name:"iPhone"} → url == format!("http://127.0.0.1:{port}/app/#token={token}")
    // and the token is a Device credential; GET body does not contain it
}

#[tokio::test]
async fn add_device_needs_sharing_on() { /* POST while off → 409 */ }

#[tokio::test]
async fn delete_revokes() { /* 204, then 404 */ }

#[tokio::test]
async fn a_fixed_host_cannot_be_toggled() { /* st.host = Some("192.168.1.2"), PUT → 409 */ }
```

Add the four routes to `guarded_routes` in `every_route_is_guarded`.

- [ ] **Step 2: Run them to verify they fail**

Run: `cargo test --locked remote::`
Expected: FAIL.

- [ ] **Step 3: Implement**

Database work runs on the blocking pool, as `board` does (`spawn_blocking`).

- [ ] **Step 4: Run the tests**

Run: `cargo test --locked`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/remote/mod.rs src/state.rs src/main.rs src/test_support.rs
git commit -m "feat(remote): /api/remote to share and pair devices"
```

---

### Task 5: Revoking closes a device's sockets

**Files:**
- Modify: `src/sessions/ws.rs` (`ws_handler`, `attach`)
- Modify: `src/files/watch.rs` (`watch_handler`)
- Modify: `src/board/events.rs` (`events`)
- Modify: `src/remote/mod.rs` (helper)

**Interfaces:**
- Consumes: `Option<Extension<Credential>>`, `Remote::closed`.
- Produces: `pub(crate) async fn closed_for(rx: &mut broadcast::Receiver<Closed>, device: &Option<String>)`: never completes for `None`; completes on `Closed::All` or a matching `Closed::Device`, and on a lagged or closed channel. Each socket loop adds a `select!` branch on it that closes the socket with code 1008.

- [ ] **Step 1: Write the failing test in `remote/mod.rs`**

```rust
#[tokio::test]
async fn revoke_closes_the_devices_socket() {
    // serve state::router on 127.0.0.1:0 with connect info; enable sharing; mint;
    // open /api/board/events?token=<device token> with Origin http://127.0.0.1:<port>
    // through tokio-tungstenite (a dev-dependency); revoke; the next read is a Close
    // frame within 1 s. A second socket opened with the main token stays open.
}
```

Add `tokio-tungstenite` to `[dev-dependencies]` if not already there; check `Cargo.toml` first.

- [ ] **Step 2: Run it to verify it fails**

Run: `cargo test --locked remote::tests::revoke_closes_the_devices_socket`
Expected: FAIL (the socket stays open).

- [ ] **Step 3: Implement `closed_for` and the branch in the three handlers**

Subscribe before `on_upgrade`, so a revoke between upgrade and the loop isn't missed.

- [ ] **Step 4: Run the tests**

Run: `cargo test --locked`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/remote/mod.rs src/sessions/ws.rs src/files/watch.rs src/board/events.rs Cargo.toml Cargo.lock
git commit -m "feat(remote): revoking a device closes its sockets"
```

---

### Task 6: The dialog

**Files:**
- Create: `web/src/app/remote/model.ts`, `web/src/app/remote/model.test.ts`
- Create: `web/src/app/remote/api.ts`
- Create: `web/src/app/remote/qr.ts`
- Create: `web/src/app/remote/view.ts`
- Modify: `web/src/app/palette/pages.ts` (ctx `openRemote(): void`, Help item)
- Modify: `web/src/app/palette/palette.ts` (pass `openRemote`)
- Modify: `web/package.json` (`uqr`)
- Modify: `web/src/styles/app.css` (dialog styles)
- Modify: `docs/architecture.md` (`remote/` rows in both the daemon and app tables, the daemon row naming `TABSH_REMOTE_ADDRESS`; `remote/model.ts` among the pure modules; `remote/qr.ts` reaches `uqr` only through `import()`)
- Modify: `src/app.html`, `src/app-assets/` (via `npm run build`)

**Interfaces:**
- Consumes: Task 4's API, `daemonFetch`, `ApiError`, `gateMode`.
- Produces:
  - `model.ts`: `export interface RemoteInfo { enabled: boolean; address: string | null; port: number; host: string | null; error: string | null; devices: RemoteDevice[] }`, `export interface RemoteDevice { id: string; name: string; created: number; last_seen: number | null }`, `export type RemoteScreen = 'forbidden' | 'host' | 'no-tailscale' | 'off' | 'on'`, `export function remoteScreen(info: RemoteInfo | 'forbidden'): RemoteScreen`, `export function lastSeen(device: RemoteDevice, now: number): string` (“Not used yet”, “Just now” under a minute, “5 min ago”, “3 h ago”, “2 d ago”).
  - `api.ts`: `getRemote(): Promise<RemoteInfo | 'forbidden'>`, `setSharing(enabled: boolean): Promise<RemoteInfo>`, `addDevice(name: string): Promise<{ id: string; name: string; url: string }>`, `revokeDevice(id: string): Promise<void>`.
  - `qr.ts`: `export async function qrSvg(text: string): Promise<SVGSVGElement>`: `const { encode } = await import('uqr')`; one `<rect>` per dark module, built with `document.createElementNS`, plus a 4-module quiet zone.
  - `view.ts`: `export function openRemote(): void` (no-op while `gateMode.val !== null`; closes the palette first, as `showWelcome` does).

`remoteScreen` order: `'forbidden'` → `forbidden`; `host` set → `host`; `address` null → `no-tailscale`; `!enabled` → `off`; else `on`. Dialog contents per screen, with the Global Constraints copy:
- `forbidden`, `host`, `no-tailscale`: the message only.
- `off`: the switch, off, and the `error` under it when set.
- `on`: the switch, then “Add device” with a name input (default “iPhone”). After adding: the QR for `url`, the link and “Copy link”, then the device list. Each row shows the name, `lastSeen`, and “Revoke”.

The URL is never written to `localStorage`, the address bar or the console.

- [ ] **Step 1: Write the failing tests in `model.test.ts`**

```ts
test('a device token gets the forbidden screen', () => assert.equal(remoteScreen('forbidden'), 'forbidden'));
test('a fixed host wins over everything else', () => assert.equal(remoteScreen({ ...on, host: '192.168.1.2' }), 'host'));
test('no address is no-tailscale, even when enabled', () => assert.equal(remoteScreen({ ...on, address: null }), 'no-tailscale'));
test('off and on', () => { assert.equal(remoteScreen({ ...on, enabled: false }), 'off'); assert.equal(remoteScreen(on), 'on'); });
test('last seen', () => {
  assert.equal(lastSeen({ ...dev, last_seen: null }, 1000), 'Not used yet');
  assert.equal(lastSeen({ ...dev, last_seen: 990 }, 1000), 'Just now');
  assert.equal(lastSeen({ ...dev, last_seen: 700 }, 1000), '5 min ago');
  assert.equal(lastSeen({ ...dev, last_seen: 1000 - 3 * 3600 }, 1000), '3 h ago');
  assert.equal(lastSeen({ ...dev, last_seen: 1000 - 2 * 86400 }, 1000), '2 d ago');
});
```

(`on` is a `RemoteInfo` with `enabled: true`, `address: '100.86.117.9'`, `host: null`; times are seconds.)

- [ ] **Step 2: Run them to verify they fail**

Run: `cd web && node --test src/app/remote/model.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `model.ts`, then `npm install uqr`, `api.ts`, `qr.ts`, `view.ts`, and the palette item**

Palette Help item, placed before “Performance…”: `{ label: 'Open on another device…', icon: icons.info, keywords: 'phone tablet tailscale remote qr share pair', run: ctx.openRemote }`.

- [ ] **Step 4: Run every app check**

Run: `cd web && npm run check && npm run lint && npm test && npm run build`
Expected: all pass. `ui/no-markup.test.ts` passes, which confirms no markup strings.

- [ ] **Step 5: Commit**

```bash
git add web/src/app/remote web/src/app/palette web/src/styles/app.css web/package.json web/package-lock.json docs/architecture.md src/app.html src/app-assets
git commit -m "feat(remote): Open on another device dialog"
```

---

### Task 7: End to end

**Files:**
- Create: `web/e2e/remote.spec.ts`
- Modify: `web/e2e/daemon.ts` (`startDaemon(opts?: { env?: Record<string, string> })`)
- Modify: `web/e2e/README.md` (the option)
- Modify: `.github/scripts/select-e2e.mjs` (rule: `src/remote/`, `web/src/app/remote/`, `src/web/guard.rs` → `remote.spec.ts`)

**Interfaces:**
- Consumes: the dialog (Task 6), `TABSH_REMOTE_ADDRESS` (Task 3).

The spec starts its own daemon with `TABSH_REMOTE_ADDRESS: '::1'`, so the second listener binds `[::1]:<port>` beside `127.0.0.1:<port>`.

- [ ] **Step 1: Write `remote.spec.ts`**

```ts
test('share, pair a device and revoke it', async ({ page }) => {
  // openApp; open the palette; choose "Open on another device…";
  // expect the switch "Share over Tailscale" unchecked; check it;
  // click "Add device" → an svg QR is visible and the link starts with `http://[::1]:<port>/app/#token=`;
  // a second page opens that link → the tab strip appears (paired over the second listener);
  // back in the dialog the device row shows "Just now"; click "Revoke";
  // the second page's terminal socket closes, and its reload lands on the pairing gate (#gate)
});

test('a device page cannot open the dialog', async ({ browser }) => {
  // pair a second page with a device link; palette → "Open on another device…"
  // → "Open this on the Mac running tabsh."
});

test('turning sharing off ends access', async () => {
  // with a device paired, uncheck the switch; a fetch to http://[::1]:<port>/api/about
  // with the device token is refused (connection refused, or 403 on a kept-alive connection)
});
```

- [ ] **Step 2: Run it**

Run: `cargo build --locked && cd web && npx playwright test e2e/remote.spec.ts`
Expected: PASS. If the runner has no IPv6 loopback, the spec skips with a message saying so; it doesn't fail.

- [ ] **Step 3: Commit**

```bash
git add web/e2e/remote.spec.ts web/e2e/daemon.ts web/e2e/README.md .github/scripts/select-e2e.mjs
git commit -m "test(remote): share, pair and revoke end to end"
```
