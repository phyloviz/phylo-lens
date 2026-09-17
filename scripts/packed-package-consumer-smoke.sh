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

# Compile both public naming generations from the tarball, not repository sources.
cat > "$FIXTURE_DIR/src/ancillary-contracts.ts" <<'TS'
import type { AncillaryData, AncillaryField, Isolate, MetadataField, PhyloLensLoadOptions, PhyloLensView, AncillaryTableInput } from "@phyloviz/phylo-lens";
export async function attach(view: PhyloLensView, table: AncillaryTableInput) {
  const result = await view.applyAncillaryData(table);
  view.updateVisualMapping({ pie: { enabled: true, fields: ["country"] } });
  return result.matchedNodeCount;
}
const fields: AncillaryField[] = [{ key: "country", type: "string" }];
const values: AncillaryData = { country: "PT" };
export const isolate: Isolate = { id: "A", ancillaryData: values };
export const current: PhyloLensLoadOptions = {
  content: "(a:1)b;", ancillarySchema: fields, ancillaryByNodeId: { a: values },
};
const legacyFields: MetadataField[] = fields;
export const legacy: PhyloLensLoadOptions = {
  content: "(a:1)b;", metadataSchema: legacyFields, metadataByNodeId: { a: values },
};
TS

cd "$FIXTURE_DIR"
npm install --package-lock-only --ignore-scripts "$PACK_DIR/$TARBALL_NAME"
npm ci
npm run build
