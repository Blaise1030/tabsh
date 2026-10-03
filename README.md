# tabsh

Your terminal, in a browser tab. A small Rust daemon keeps your shells running on
your machine; open them from any browser tab at https://tabsh.cc.

```sh
cargo install --git https://github.com/Blaise1030/tabsh
tabsh   # prints a link that opens the app, paired
```

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
