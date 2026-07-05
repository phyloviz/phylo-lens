# PhyloLens Client

TypeScript renderer for scalable phylogenetic visualization. It draws with
Sigma.js over a Graphology graph, driving the server's level-of-detail loop:
prepare a dataset once, then pull only the viewport slice for the current camera
at the current zoom tier. See the [`docs/`](../../docs/README.md) set for the
full architecture, and [`docs/CLIENT_RENDERING.md`](../../docs/CLIENT_RENDERING.md)
for the rendering internals.

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

## Consuming as a library

The public surface is re-exported from `src/index.ts` and organized in three
layers — Transport (`createGraphClient`), Workbench (`createGraphWorkbench`),
and Shell (`bootstrapClientShell`). Most host apps target the Workbench layer,
which handles the entire prepare → poll → viewport loop internally:

```ts
import {
  createGraphClient,
  createGraphWorkbench,
  DefaultRendererFactory,
  RENDERER_KIND_SIGMA,
} from "phylo-lens-client";

const workbench = createGraphWorkbench({
  graphClient: createGraphClient({ baseUrl: "http://localhost:8000" }),
  rendererFactory: new DefaultRendererFactory(),
  rendererKind: RENDERER_KIND_SIGMA,
  renderContext: { containerId: "graph-root" },
});

await workbench.renderNewick(newickString, "my-dataset");
```

See the **Consuming the client as a library** section in
[`docs/CLIENT_RENDERING.md`](../../docs/CLIENT_RENDERING.md) for the layered
facade table, the full `renderNewick` options, and teardown.
