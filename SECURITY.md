# Security

tabsh runs shells, so a hole in the daemon is a hole on your machine. Please
report suspected vulnerabilities privately, not in a public issue.

## Reporting

Use GitHub's private vulnerability reporting:

https://github.com/Blaise1030/tabsh/security/advisories/new

Include the version, your OS, the steps, and what an attacker gains. A proof of
concept is welcome; a description is enough to start. I aim to acknowledge within
72 hours and to ship a fix or a mitigation as soon as it is understood.

Please do not open a public issue, post the details on social media, or test
against a daemon you don't own. If you need a channel other than GitHub, say so
in the advisory and we'll find one.

## What is in scope

- Authentication or authorization bypass in the daemon.
- Reading or writing files outside the intended folders.
- Command execution beyond what the paired user asked for.
- Leaking the pairing token (logs, URLs sent to a server, referrers).
- Cross-site requests that reach the daemon from another origin.
- XSS or HTML injection in the app that can reach the daemon.
- Dependency vulnerabilities that are actually reachable.

## What is not in scope

- Someone who already has a shell as your user, or can read `~/.tabsh/token`.
- A daemon deliberately exposed on `0.0.0.0` or a LAN address. It is designed
  for loopback; use Tailscale or an SSH tunnel if you need another device.
- An agent or MCP server you chose to run. It runs with your permissions by
  design.
- Denial of service from your own shells or a local process.

## The model, in one paragraph

The daemon binds `127.0.0.1` by default, creates a random token in
`~/.tabsh/token`, and accepts API and WebSocket requests only with that token.
It also checks the `Origin`/`Host` of browser requests so another site cannot
drive it. The token is placed in the URL fragment, which browsers do not send to
servers, and the hosted app at `tabsh.cc` only talks to the daemon over
loopback. There is no account, no relay, and no telemetry.

If you find a gap between that paragraph and the code, that's a vulnerability
worth reporting.
