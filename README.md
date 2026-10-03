# tabsh

Your terminal, in a browser tab. A small Rust daemon keeps your shells running on
your machine; open them from any browser tab at https://tabsh.cc.

```sh
cargo install --git https://github.com/Blaise1030/tabsh
tabsh   # opens the app in your browser, paired
```

Safari (and every iOS browser) won't let https://tabsh.cc reach the daemon, so
tabsh also serves the app itself, and tabsh.cc sends Safari there:
`http://tabsh.localhost:7681`. File → Add to Dock opens it like an app.

Set `TABSH_NO_BROWSER=1` to start without opening a browser (e.g. as a service);
it's skipped over SSH and on Linux without a display anyway.

## Working on the app page

The daemon embeds a copy of the app page (`src/app.html`). `npm run build` in
`web/` refreshes it; commit it along with your changes, or CI fails.

## Commits and releases

Commit messages (or squash-merge PR titles) follow
[Conventional Commits](https://www.conventionalcommits.org): `feat: …`, `fix: …`,
`perf: …`, and `!` for breaking changes (`feat!: …`). Other types (`chore`, `ci`,
`docs`, `refactor`, …) are fine too but stay out of the changelog.

Releases are automatic:

1. Every push to `main` updates a **`chore(release): vX.Y.Z`** pull request.
   [changelogen](https://github.com/unjs/changelogen) writes the new
   `CHANGELOG.md` section and bumps the version (in `package.json`, copied into
   `Cargo.toml`).
2. Merging that PR builds the daemon for macOS and Linux and publishes a GitHub
   release with the changelog section as its notes.

Before 1.0, `feat` and `fix` bump the patch version and breaking changes bump the
minor version. To release a specific version, run the **Release PR** workflow by
hand with a `version`.

## License

MIT — see [LICENSE](LICENSE).
