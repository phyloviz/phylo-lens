# PhyloLens Client

Embeddable TypeScript visualization library for scalable phylogenetic views. A
host application provides a DOM container, the URI of a separately deployed
PhyloLens API service, and dataset content; the library owns the prepare, polling,
viewport synchronization, and rendering loop internally. See the
[`docs/`](../../docs/README.md) set for the full architecture, and
[`docs/CLIENT_RENDERING.md`](../../docs/CLIENT_RENDERING.md) for rendering
internals.

The package ships two ways: a **demo app** for local exploration, and a
**consumable library** (`@phyloviz/phylo-lens`) a host app such as PHYLOViZ can
embed.

## Setup

```bash
cd code/client
npm ci
```

## Develop (demo app)

```bash
npm run dev     # dev server on http://localhost:3000, proxies /api and /health → :8000
```

The demo uses same-origin requests by default, so the browser calls `/health`
and `/api/...` on the Vite origin. Set `VITE_PHYLO_LENS_PROXY_TARGET` when the
backend is not on `http://localhost:8000`:

```bash
VITE_PHYLO_LENS_PROXY_TARGET=http://127.0.0.1:8001 npm run dev
```

## Build

```bash
npm run build       # demo build (index.html → dist/)
npm run build:lib   # library build: dist/index.js (ESM) + dist/types/*.d.ts
```

`build:lib` emits the embeddable package entry. The default implementation uses
Sigma, Graphology, ForceAtlas2, and Sigma node programs internally; those are
installed as package dependencies so ordinary host applications do not install
or configure them manually. They remain externalized from `dist/index.js` so the
host bundler resolves them from dependencies instead of receiving a large
pre-bundled copy.

## Test

```bash
npm test        # vitest run
```

## Embedding PhyloLens

Host applications should use `createPhyloLensView` from the package root. The
computational API service is deployed separately; HTTP endpoints, prepared
dataset ids, layout versions, polling, renderer factories, and viewport
synchronization are internal implementation details.

```ts
import { createPhyloLensView } from "@phyloviz/phylo-lens";

const container = document.getElementById("graph-root");
if (!(container instanceof HTMLElement)) {
  throw new Error("Missing graph container.");
}

const view = createPhyloLensView({
  container,
  apiUrl: "",
});

await view.load({
  content: newickString,
  name: "my-dataset",
  sourceFormat: "newick",
  metadataSchema,
  metadataByNodeId,
});

view.dispose();
```

`apiUrl` may be an absolute API origin, the empty string for a same-origin
`/health` + `/api/...` proxy, or a proxy prefix such as `"/phylo-lens/api"`.
The first `load()` call reads `${apiUrl}/health` and checks the service
`api_version` before submitting a prepare job; incompatible or unreachable
services fail early with exported compatibility errors.

The local demo/reference application is useful for exploration, but it is not the
public integration API.
