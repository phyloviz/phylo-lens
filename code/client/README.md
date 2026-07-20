# PhyloLens Client

Embeddable TypeScript visualization library for scalable phylogenetic views. A
host application provides a DOM container, the URI of a separately deployed
PhyloLens API service, and dataset content; the library owns the prepare, polling,
viewport synchronization, and rendering loop internally. See the
[`docs/`](../../docs/README.md) set for the full architecture, and
[`docs/CLIENT_RENDERING.md`](../../docs/CLIENT_RENDERING.md) for rendering
internals.

The package ships two ways: a **demo app** for local exploration, and a
**consumable library** (`phylo-lens-client`) a host app such as PHYLOViZ can
embed.

## Setup

```bash
cd code/client
npm ci
```

## Develop (demo app)

```bash
npm run dev     # dev server on http://localhost:3000, proxies /api → :8000
```

The demo expects the backend running at `http://localhost:8000` (see
[`../server/README.md`](../server/README.md)).

## Build

```bash
npm run build       # demo build (index.html → dist/)
npm run build:lib   # library build: dist/index.js (ESM) + dist/types/*.d.ts
```

`build:lib` externalizes the rendering stack (`sigma`, `graphology`, the
graphology layout packages, and the `@sigma/*` programs) as **peer
dependencies**, so a host app supplies a single shared copy rather than bundling
a duplicate Sigma/Graphology.

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
import { createPhyloLensView } from "phylo-lens-client";

const container = document.getElementById("graph-root");
if (!(container instanceof HTMLElement)) {
  throw new Error("Missing graph container.");
}

const view = createPhyloLensView({
  container,
  apiUrl: "http://localhost:8000",
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

The local demo/reference application is useful for exploration, but it is not the
public integration API.
