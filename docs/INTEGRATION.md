# Choose your components

PhyloLens has two independently deployable components: a browser viewer and an
HTTP preparation/query service. Their integration does not require a shared
database, Python imports in the browser, or knowledge of Sigma internals.

| Integration | What you implement | Supported boundary |
| --- | --- | --- |
| Default pairing | A host page and service configuration | `createPhyloLensView({ container, apiUrl })` |
| Another frontend | Your UI and rendering | The service's documented JSON HTTP API and OpenAPI schema |
| Another data service or local data | A `GraphClient` adapter | `createPhyloLensView({ container, graphClient })` |

## Use the browser with your own adapter

```ts
import { createPhyloLensView, type GraphClient } from '@phyloviz/phylo-lens';

const client: GraphClient = {
  prepareGraph: request => yourService.prepare(request),
  readViewport: (request, options) => yourService.viewport(request, options?.signal),
};

const view = createPhyloLensView({ container, graphClient: client });
```

Supply exactly one of `apiUrl` and `graphClient`. The public TypeScript options
express this choice, and runtime checks cover JavaScript callers. A supplied
adapter owns its transport, authentication and runtime validation. It does not
need to implement `/health`, HTTP job polling, or the default adapter's wire DTOs.

The [precomputed example](../examples/custom-client-host/README.md) is a complete
external host using the packed npm package and an in-memory tree, without an API
service. It implements the two required operations plus optional search.

### Required operations

| Operation | Contract |
| --- | --- |
| `prepareGraph` | Resolve when the input is ready for viewport reads. Return a dataset ID, immutable layout version, counts, layout status and warnings. Echo requested typing settings and distance cutoff when applied. Reject unsupported input or options explicitly. |
| `readViewport` | Return a coherent slice of that exact dataset/version with node positions, edges whose endpoints are present, counts, truncation and LoD information. Honor explicit node budgets and cancellation when possible. |

Identifiers, request/result types, node annotations, and tree index types are
exported from the package root. Adapter contracts use camelCase. The default HTTP
adapter maps these to the service's snake_case JSON encoding.

### Optional operations

`searchGraph`, `readRegion`, `applyAncillaryData`, `readComponents`,
`readDistanceConnections`, and `setTechnicalRoot` enable their corresponding
features. An adapter can omit operations it does not provide. Calling an
unsupported operation rejects with an explanatory error; component listing
returns an empty list when unavailable. Display-based box selection can still
work without a stored region query.

Hosts should expose controls appropriate to their adapter. Rerooting support can
be checked with `view.canSetTechnicalRoot()`.

### Semantic requirements

- Keep tree edges authoritative. Distance connections belong to a separate overlay.
- A layout version identifies an immutable combination of geometry, orientation,
  LoD and annotations. Never reuse it for different data.
- Every displayed LoD group must represent a coherent connected subtree. Its
  counts and observations must describe the represented members.
- Supply canonical subtree intervals for manual branch folding. A representative
  ID and an isolate identity have different meanings.
- Keep original isolate observations available when equivalent profiles share
  one biological node. Preserve nonempty categories, zero distances and declared
  distance units.
- Do not silently ignore requested inference or cutoff settings. The viewer
  checks their confirmation before showing a prepared result.

See [tree indexing](TREE_INDEX.md), [expansion](EXPAND_COLLAPSE.md), and the
[data model](DATA_MODEL.md) for these invariants. The adapter interface describes
what the viewer consumes; it does not prescribe how another backend stores data.

## Customize the existing HTTP adapter

The default adapter is also public. A host can supply its own fetch transport,
for example to attach credentials required by its deployment:

```ts
import { createGraphClient, createPhyloLensView } from '@phyloviz/phylo-lens';

const graphClient = createGraphClient({
  baseUrl: '/phylo-lens',
  fetchImpl: (url, init) => fetch(url, { ...init, credentials: 'include' }),
});
const view = createPhyloLensView({ container, graphClient });
```

The adapter performs service-version checks, job polling, runtime response
validation and DTO mapping. Authentication and CORS policy remain deployment
concerns; the service itself does not implement an identity system.

## Use the server with another frontend

The server does not require the npm viewer. A minimal client:

1. Reads `/health` and checks `api_version`.
2. Submits `POST /api/graph/prepare`.
3. Polls `GET /api/graph/prepare/{job_id}` until ready or failed.
4. Uses the returned dataset ID and explicit layout version for viewport reads.
5. Implements the additional operations its UI needs.

The [HTTP reference](API_REFERENCE.md) defines route semantics, errors and JSON
shapes. A running FastAPI service exposes `/openapi.json` and interactive `/docs`.
Implementation versions identify releases; `api_version` identifies the HTTP
compatibility family. Optional additive operations require a service that
supports them, even within the same compatibility family.

## Compatibility checks

The client suite tests adapter injection without constructing an HTTP client.
The packed-consumer smoke builds both the default external host and the custom
adapter host using the actual tarball. The server suite exercises its HTTP
contracts directly without the browser. Browser checks additionally render the
custom example and exercise real technical-root changes through the service.
