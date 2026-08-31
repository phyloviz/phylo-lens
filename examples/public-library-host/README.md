# PhyloLens external-host proof of concept

This is a small Vite/TypeScript application designed for a thesis jury (or any
external developer) to run PhyloLens as they would use it in a real project.
It installs the published [`@phyloviz/phylo-lens`](https://www.npmjs.com/package/@phyloviz/phylo-lens)
package from npm; it does not import the library source or use repository path aliases.

The page renders two Newick datasets, supports the library's pan and zoom
interaction, and exports the visible view as a PNG.

## Release status

This proof of concept installs `@phyloviz/phylo-lens@0.2.1`, which includes the
library bundle and TypeScript declarations required by an external host.

## Run it

Start the separately deployable API service in one terminal:

```bash
docker run --rm -p 8000:8000 \
  -e PHYLO_LENS_CORS_ORIGINS=http://localhost:5173 \
  -v phylo-lens-data:/data \
  ghcr.io/phyloviz/phylo-lens-service:0.2.0
```

Then install and start this independent browser host in another terminal:

```bash
cd examples/public-library-host
npm install
npm run dev
```

Open the URL printed by Vite (normally `http://localhost:5173`). The Vite
development server proxies `/health` and `/api` to `http://localhost:8000`.
Set `VITE_PHYLO_LENS_PROXY_TARGET` when the service runs elsewhere, or set
`VITE_PHYLO_LENS_API_URL` to call a configured service URL directly.

## What is being validated

- npm registry installation, ESM exports, TypeScript declarations and library-owned runtime dependencies;
- public `createPhyloLensView()` integration from a standalone host;
- independent service preparation and viewport reads;
- an interactive rendered view and PNG export.

## Distribution smoke test

From the repository root, run:

```bash
./scripts/packed-package-consumer-smoke.sh
```

That stricter CI check rebuilds the browser library, packs it with `npm pack`,
installs the generated tarball in a temporary copy of this host, and builds it.
It complements the npm-registry proof of concept above by catching packaging
errors before publication.
