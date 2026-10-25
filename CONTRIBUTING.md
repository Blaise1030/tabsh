# Contributing

Small, focused changes are easiest to review. If you're planning something
larger than a bug fix, open an issue first so we can agree on the shape.

## Setup

```sh
cargo build
(cd web && npm install && npm run build)
TABSH_DB=target/dev/state.db TABSH_ORIGINS= cargo run -- 7682
```

That runs beside your everyday tabsh on 7681, with its own port, sessions and
token. Open `http://tabsh.localhost:7682`.

`npm run build` in `web/` refreshes the daemon's embedded copy of the app
(`src/app.html`, `src/app-assets/`). Commit those files with your web changes;
the release build fails if they don't match.

## Tests

```sh
cargo test
cd web && npm test && npm run check && npm run lint
```

The browser end-to-end suite spins a real daemon and runs in Chromium, one
worker at a time:

```sh
cd web && npm run test:e2e
```

If you change the board, the chat panel or the install path, add a test at the
level where the behaviour lives. Screenshot-only changes don't need one.

## Commits and releases

Messages follow [Conventional Commits](https://www.conventionalcommits.org):

- `feat: …`, `fix: …`, `perf: …` appear in the changelog.
- `chore`, `ci`, `docs`, `refactor`, `test` do not.
- `!` marks a breaking change (`feat!: …`).

Releases are automatic. A push to `main` updates the release PR; merging it
builds the binaries, publishes the GitHub release, updates the Homebrew tap and
deploys the site. Don't tag or edit the release by hand.

## Style

- Rust: `cargo fmt` and `cargo clippy` before pushing.
- Web: Biome formats and lints (`npm run format`, `npm run lint`).
- Comments explain why, not what. Keep the dry tone; no marketing in code or
  docs.
- Don't add telemetry or a network call that isn't necessary for the feature.
  "Nothing leaves localhost" is a product promise, not a slogan.

## Reporting bugs and security

Use the issue templates for bugs and launch feedback. For vulnerabilities, see
[SECURITY.md](SECURITY.md); please don't open a public issue.
