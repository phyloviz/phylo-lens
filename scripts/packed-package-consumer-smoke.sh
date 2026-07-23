#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export npm_config_cache="${npm_config_cache:-${TMPDIR:-/tmp}/phylo-lens-npm-cache}"

cd "$REPO_ROOT/code/client"
npm ci
npm run build:lib
npm pack

cd "$REPO_ROOT/examples/public-library-host"
npm ci
npm run build
