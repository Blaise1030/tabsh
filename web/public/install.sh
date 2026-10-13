#!/bin/sh
# Installs the latest tabsh release binary.
# usage: curl -fsSL https://tabsh.cc/install.sh | sh
# env: TABSH_VERSION (e.g. 0.4.0; default latest), TABSH_INSTALL_DIR (default ~/.local/bin)
set -eu

repo=Blaise1030/tabsh
dir=${TABSH_INSTALL_DIR:-$HOME/.local/bin}

die() { echo "tabsh install: $*" >&2; exit 1; }

case $(uname -s) in
  Darwin) os=apple-darwin ;;
  Linux) os=unknown-linux-gnu ;;
  *) die "unsupported OS $(uname -s); try: cargo install --git https://github.com/$repo" ;;
esac
case $(uname -m) in
  arm64 | aarch64) arch=aarch64 ;;
  x86_64 | amd64) arch=x86_64 ;;
  *) die "unsupported CPU $(uname -m); try: cargo install --git https://github.com/$repo" ;;
esac
target=$arch-$os

command -v curl >/dev/null || die "curl is required"
command -v tar >/dev/null || die "tar is required"

version=${TABSH_VERSION:-}
if [ -z "$version" ]; then
  latest=$(curl -fsSLI -o /dev/null -w '%{url_effective}' "https://github.com/$repo/releases/latest")
  version=${latest##*/v}
  [ -n "$version" ] && [ "$version" != "$latest" ] || die "couldn't find the latest release"
fi
version=${version#v}

name=tabsh-v$version-$target
url=https://github.com/$repo/releases/download/v$version/$name.tar.gz

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

echo "Downloading tabsh $version ($target)..."
curl -fsSL "$url" -o "$tmp/$name.tar.gz" || die "download failed: $url"
curl -fsSL "$url.sha256" -o "$tmp/$name.tar.gz.sha256" || die "checksum download failed: $url.sha256"

want=$(cut -d' ' -f1 "$tmp/$name.tar.gz.sha256")
if command -v sha256sum >/dev/null; then
  got=$(sha256sum "$tmp/$name.tar.gz" | cut -d' ' -f1)
else
  got=$(shasum -a 256 "$tmp/$name.tar.gz" | cut -d' ' -f1)
fi
[ "$want" = "$got" ] || die "checksum mismatch for $name.tar.gz"

tar -xzf "$tmp/$name.tar.gz" -C "$tmp"
mkdir -p "$dir"
mv "$tmp/$name/tabsh" "$dir/tabsh"
chmod 755 "$dir/tabsh"

echo "Installed tabsh $version to $dir/tabsh"
case :$PATH: in
  *:"$dir":*) echo "Run: tabsh" ;;
  *) echo "Add $dir to your PATH, e.g. echo 'export PATH=\"$dir:\$PATH\"' >> ~/.profile, then run: tabsh" ;;
esac
