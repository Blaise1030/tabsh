# Release 1.0.0

The launch version should already be live before the Product Hunt listing goes
up. This is the exact path.

## Why 1.0

`0.1.40` reads as a prototype on a launch page, and the core is not one: the
daemon persists shells, the board and hooks work, and install, upgrade and
Homebrew paths exist. Shipping 1.0 also gives the launch a clean changelog
section instead of a chat-fix patch. The cost is the expectation of stability;
mitigate it by shipping a fast `1.0.1` for launch-week bugs.

If you'd rather not promise 1.0, run the same steps with `-f version=0.1.41`
and keep the version out of launch copy. Do not launch `0.1.40` as-is.

## Preconditions

- [ ] The landing branch (`web/update-landing-page`) is merged to `main`.
- [ ] The mobile/launch fixes are merged.
- [ ] `cd web && npm test && npm run check && npm run lint` pass.
- [ ] `cargo test` passes.
- [ ] `npm run build` in `web/` is committed: `src/app.html` and
      `src/app-assets/` match the web source. The release workflow fails
      otherwise.
- [ ] `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` exist as repository
      secrets, otherwise the deploy step is skipped with a warning.
- [ ] `HOMEBREW_TAP_DEPLOY_KEY` exists, otherwise the tap update fails after
      the release is published.

## Cut it

```sh
# from a clean main
gh workflow run release-pr.yml -f version=1.0.0
gh run watch
```

The workflow opens (or updates) `release/next` with `chore(release): v1.0.0`,
the new `CHANGELOG.md` section and the version bump in `package.json` and
`Cargo.toml`.

Review the PR:

- [ ] The changelog reads like a release, not a commit list. Rewrite entries you
      don't want on the site.
- [ ] The version is `1.0.0` in `package.json` and `Cargo.toml`.
- [ ] CI is green.

Merge it. That push to `main` runs `release.yml`, which:

1. builds four targets (macOS arm64/x86-64, Linux x86-64/arm64),
2. runs the full e2e suite,
3. builds the site and checks the embedded app copy,
4. creates the GitHub release with the changelog section,
5. updates `Formula/tabsh.rb` in `Blaise1030/homebrew-tap`,
6. deploys `web/dist` to Cloudflare.

## Verify (do not skip)

```sh
gh run watch
gh release view v1.0.0
curl -fsSL https://tabsh.cc | head -40          # new headline, not the old one
curl -fsSLI https://tabsh.cc/og.png | head -5   # 200, image/png
```

- [ ] `https://tabsh.cc` shows "YOUR SHELLS AND AGENTS, ONE CALM SCROLL".
- [ ] The GitHub release has 4 `.tar.gz` files and 4 `.sha256` files.
- [ ] `brew update && brew upgrade tabsh` picks up 1.0.0.
- [ ] The tap's formula points at the new checksums.
- [ ] A clean install works:

```sh
tmp=$(mktemp -d)
TABSH_INSTALL_DIR="$tmp" TABSH_VERSION=1.0.0 \
  sh -c 'curl -fsSL https://tabsh.cc/install.sh | sh'
"$tmp/tabsh" --version
```

- [ ] The daemon starts on a spare port and pairs in a browser:
      `TABSH_DB=target/launch.db "$tmp/tabsh" 7682`.
- [ ] `/press/` and `/demo/` load, and `/sitemap.xml` includes `/press/`.

## If the deploy is skipped

The release still exists. Re-run only the deploy with the repository secrets
set, or build and deploy from a machine with `wrangler login`:

```sh
cd web && npm ci && npm run build && npx wrangler deploy
```

## If the release is broken

Do not delete the tag. Ship `1.0.1` with the fix; the release workflow is built
around versions, not mutable releases. If an install is broken, edit the
listing's first comment to point at the last known-good version
(`TABSH_VERSION=0.1.40`) while the fix goes out.
