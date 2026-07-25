# Packed-package consumer fixture

This directory is a minimal external Vite/TypeScript application used to verify
`@phyloviz/phylo-lens` as a published-style npm artifact.

The fixture must consume the tarball produced by `npm pack`. It must not import
from `code/client/src`, use TypeScript path aliases into the repository, or rely
on the client workspace's installed dependencies.

## Run from the repository root

```bash
./scripts/packed-package-consumer-smoke.sh
```

The script:

1. installs client dependencies;
2. builds the library;
3. packs the npm tarball;
4. installs the fixture dependencies against that tarball;
5. builds the external host.

## Manual validation

```bash
cd code/client
npm ci
npm run build:lib
npm pack

cd ../../examples/public-library-host
npm ci
npm run build
```

The fixture validates:

- package-root exports;
- ESM resolution;
- included TypeScript declarations;
- runtime dependency ownership;
- absence of source-tree coupling;
- compatibility with a standard Vite browser build.

It is intentionally small. Product demonstrations and renderer experiments
belong in `code/client`; this fixture should change only when the public package
contract or distribution layout changes.
