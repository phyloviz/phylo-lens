#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export npm_config_cache="${npm_config_cache:-${TMPDIR:-/tmp}/phylo-lens-npm-cache}"

cd "$REPO_ROOT/code/client"
npm ci
npm run build:lib

PACK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/phylo-lens-package.XXXXXX")"
FIXTURE_DIR="$(mktemp -d "${TMPDIR:-/tmp}/phylo-lens-packed-consumer.XXXXXX")"
trap 'rm -rf "$PACK_DIR" "$FIXTURE_DIR"' EXIT
TARBALL_NAME="$(npm pack --pack-destination "$PACK_DIR" --json | node -p 'JSON.parse(require("node:fs").readFileSync(0, "utf8"))[0].filename')"
cp -R "$REPO_ROOT/examples/public-library-host/." "$FIXTURE_DIR"

cd "$FIXTURE_DIR"
npm install --package-lock-only --ignore-scripts "$PACK_DIR/$TARBALL_NAME"
npm ci
npm run build
