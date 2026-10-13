# Open on another device

**Status:** draft (2026-10-12)
**Goal:** From tabsh on the Mac, open the same tabsh on a trusted device on the same Tailscale network: turn sharing on, scan a QR code, and the phone is paired. Each device gets its own token, listed in tabsh, revocable.

## Non-goals

- HTTPS, `tailscale serve`, or MagicDNS names. The phone opens `http://<tailscale IPv4>:<port>/app/`. Tailscale encrypts the traffic; iOS still treats the page as not secure, so clipboard and notifications stay limited.
- Installing or signing in to Tailscale. The dialog only says so when no Tailscale address is found.
- LAN sharing, or any address outside the Tailscale range.
- Per-device permissions beyond one rule: a device token can't manage sharing or devices.
- Starting the daemon on login or keeping it running. That stays `brew services`.

## Why the daemon listens itself

A forwarder in front of the loopback listener makes every caller look like `127.0.0.1`. Today a request with no Origin and no token is let through on every route except `/api/files*`, so a tailnet peer behind such a forwarder could create a card with any command (`POST /api/sessions`) and start it (`PATCH /api/sessions/{id}/status`). The daemon must see the real peer address, so it opens a second listener on the Tailscale address and treats every non-loopback peer as needing a token.

## Sharing

Sharing is off by default. Turning it on in the dialog:

1. finds this Mac's Tailscale IPv4 address: an address in `100.64.0.0/10` on a point-to-point interface (`utun*` on macOS, `tailscale0` on Linux), read with `getifaddrs` (`libc`, already a dependency). An address in that range on any other interface, such as carrier NAT on Wi-Fi, never counts;
2. binds `<address>:<port>`, the same port as the loopback listener, and serves the same router on it;
3. saves `enabled = 1`, so a daemon restart turns it back on.

At startup with sharing on and no Tailscale address yet, the daemon looks again every 30 seconds until it finds one. If the bind fails, the dialog shows the error and sharing stays off.

Turning it off stops the second listener, closes every socket a device token opened, and saves `enabled = 0`. Device tokens are kept, so turning it on again needs no new scan.

When the daemon already listens on a non-loopback `HOST`, the dialog says so and offers no switch.

## Devices

A device is a row in a new `devices` table (`id`, `name`, `token`, `created`, `last_seen`), created in `open_db` next to `sessions` and `settings`. The `remote` table holds the one `enabled` flag.

- **Add device:** the dialog asks for a name (default “iPhone”), the daemon mints a token with `random_hex(32)`, and the dialog shows a QR code of `http://<address>:<port>/app/#token=<token>`, with the link under it to copy. The token is returned once, at minting; the list never shows it again.
- **Revoke:** deletes the row and closes that device's open sockets at once.
- `last_seen` is updated at most once a minute per device.

A device opens the app at its own origin, `http://<address>:<port>`. The guard already allows it: the Host is an IP, and the Origin equals `http://<Host>`. `adoptToken` keeps the token under that origin, as it does today.

## Guard

The guard learns which credential a request carries: the main token, a device token (by id), or none.

- **Loopback peer:** unchanged.
- **Non-loopback peer:** every request needs the main token or a device token, with or without an Origin. The exceptions are GET or HEAD of `/`, `/open`, `/app`, `/app/`, `/_astro/{name}` and `/sounds/{*path}`. `/` and `/open` already give the token only to loopback peers.
- **Device token:** accepted on every route except `/api/remote*`, which answers 403.
- **Sharing off:** a non-loopback peer is refused (403), so a connection kept alive from before sharing was turned off can't go on.
- **No peer address:** refused. Both listeners record it.

A socket remembers the device it was opened with, so revoking that device or turning sharing off can close it.

## API

All under `/api/remote`, main token only.

| Route | Does |
|---|---|
| `GET /api/remote` | `{enabled, address, port, host, error, devices: [{id, name, created, last_seen}]}`; `address` is null when Tailscale isn't found; `host` is the daemon's `HOST` when it isn't loopback, else null |
| `PUT /api/remote` | `{enabled}`: turns sharing on or off |
| `POST /api/remote/devices` | `{name}` → `{id, name, url}`; `url` carries the token in its fragment |
| `DELETE /api/remote/devices/{id}` | Revokes |

## App

The palette's Help group gains **Open on another device…** (keywords: phone, tablet, tailscale, remote, qr). It opens a dialog from a new `remote/` folder:

- `remote/model.ts`: pure. Maps the API's answer to what the dialog shows: no Tailscale address, sharing off, on with no devices, on with devices, or not allowed (a device token got 403: “Open this on the Mac running tabsh”).
- `remote/api.ts`: the four calls, through `daemonFetch`.
- `remote/view.ts`: the VanJS dialog, which holds the switch, Add device, the QR code, the copy link and the device list with Revoke.
- `remote/qr.ts`: draws the QR code as SVG elements from a module matrix. The encoder (a small dependency-free package, such as `uqr`) is reached only through `import()` when the dialog opens. No markup strings.

The dialog with no Tailscale address says: “Install Tailscale on this Mac and the other device, sign both in to the same account, then reopen this.”

## Daemon layout

- `remote/mod.rs`: `routes()`, the `remote` and `devices` tables, minting and revoking.
- `remote/listen.rs`: finding the Tailscale address, and starting and stopping the second listener.
- `web/guard.rs`: the peer rule and the credential.
- `AppState` gains the listener's handle and a broadcast of closed devices.

## Docs

`docs/architecture.md` gains rows for `remote/` on both sides. Its security invariants gain: “From a non-loopback peer, every route needs a token, with or without an Origin, except the page and its public assets,” and “A device token can't reach `/api/remote*`.”

## Testing

- `guard.rs`: a non-loopback peer without a token is refused on `/api/sessions` (POST), `/api/sessions/{id}/status` (PATCH) and `/ws`, with and without an Origin; the page and asset exceptions pass; a device token passes `/api/sessions` and gets 403 on `/api/remote`; a revoked token is refused.
- `remote/listen.rs`: the address picker takes `100.64.0.0/10` on `utun*` and `tailscale0` only, and ignores it on `en0`.
- `remote/mod.rs`: minting returns the token once; the list never includes it; revoke closes that device's sockets; `enabled` survives a reopen of the database.
- `state.rs`: `every_route_is_guarded` covers the new routes.
- `remote/model.test.ts`: each of the dialog's states.
- Playwright: the dialog with sharing off, on, a device added and revoked, against a daemon with a stubbed address.

## Success criteria

- From the palette on the Mac, a phone on the same tailnet is paired in one scan.
- Revoking a device ends its access at once, open terminals included.
- With sharing off, nothing listens outside loopback.
- With sharing on, no tailnet peer reaches any API or socket without a token.
