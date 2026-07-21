# Architecture

PhyloLens is split into a server-side **data engine** and a Sigma.js **client**.
The server owns phylogenetic semantics: parsing, normalization, threshold
clustering, force-directed layout, level-of-detail (LoD) precomputation, and
bounded viewport reads. The client owns interaction: camera state, semantic-zoom
tier selection, rendering, colors, and local metadata filtering.

This document is the system-level map. For the runtime narrative see
[`flow.md`](./flow.md); for contracts and storage see
[`DATA_MODEL.md`](./DATA_MODEL.md); for the prepare pipeline see
[`SERVER_PIPELINE.md`](./SERVER_PIPELINE.md); for the zoom engine see
[`LOD_AND_CLUSTERING.md`](./LOD_AND_CLUSTERING.md); for rendering see
[`CLIENT_RENDERING.md`](./CLIENT_RENDERING.md).

## Design Principles

1. **Semantics stay server-side.** Parsing, validation, weighted clustering,
   layout, and slice selection are server concerns. The client never re-derives
   topology.
2. **Precompute before interaction.** All expensive global work happens once in
   `prepare`. Interactive camera updates issue bounded, indexed viewport reads.
3. **Materialize, don't recompute.** Prepared artifacts (clusters, per-tier
   edges, node positions, metadata) are persisted keyed by
   `(dataset_id, layout_version)` and read back by query, not rebuilt. Local
   mode uses SQLite; distributed production mode uses Postgres.
4. **Keep runtime payloads bounded.** A viewport read uses `max_nodes` as the
   primary slice budget; the response carries a `truncated` flag and the true
   `total_node_count` so the client knows it is seeing a slice. Edge-preserving
   neighbor nodes and explicit cluster expansion may add nodes beyond that
   primary budget.
5. **Rendering is adapter-based.** Sigma-specific behavior lives behind the
   `GraphRenderer` interface and must not leak into API contracts or clustering.

## Route Contract

The runtime is driven by FastAPI routes under the prefix `/api/graph`
(`http/graph/router.py`, `ROUTER_PREFIX`). Prepare and viewport are the core loop;
region is an on-demand read for a hand-drawn selection box. This section is the
system-level summary; for the field-by-field request/response models, error
shapes, and the prepare lifecycle see [`API_REFERENCE.md`](./API_REFERENCE.md):

- **`POST /api/graph/prepare`** — `prepare_graph()`. Takes a
  `NormalizeRequest`, normalizes it into a `CanonicalDataset` (synchronously, so
  bad input fails with a `4xx`), then submits the force-directed layout to a
  background worker and returns `202 Accepted` with a `GraphPrepareJob`
  (`job_id`, `status: "pending"`, `dataset_id`).
- **`GET /api/graph/prepare/{job_id}`** — `prepare_graph_status()`. Polls
  a prepare job, returning `GraphPrepareStatus` (`status` of
  `pending`/`ready`/`failed`; the full `GraphPrepareResponse` under `result`
  once ready — `dataset_id`, `layout_version`, counts, `lod_tier_count`,
  `layout_status`, `warnings`; or `error` when failed). Unknown `job_id` → `404`.
- **`POST /api/graph/viewport`** — `read_graph_viewport()`. Takes a
  `GraphViewportQuery` (bounds, `zoom`, `lod_level`, `cluster_id`, `max_nodes`)
  and returns a `GraphViewportResponse` (visible `nodes`, `edges`,
  `total_node_count`, `truncated`, stable full-layout `global_bounds`,
  `metadata_schema`).
- **`POST /api/graph/region`** — `read_graph_region()`. Takes a
  `GraphRegionQuery` (required bounds `xmin/xmax/ymin/ymax`, `max_nodes`) and
  returns a `GraphRegionResponse`: the isolated subgraph inside the box plus
  `aggregated_metadata` (mode for categorical/boolean, mean for numeric) so the
  client can render a region-selection stats panel. Unlike viewport, it takes no
  `zoom`/`lod_level` — it always reads finest-detail nodes in the box.

There is no separate `normalize` route in the runtime path: normalization is a
step inside `prepare`. Defaults: `DEFAULT_MAX_VIEWPORT_NODES = 2500`,
`HARD_MAX_VIEWPORT_NODES = 20000`.

## Server Modules

### `core`

Pydantic contracts and domain errors: `CanonicalDataset`, `CanonicalNode`,
`CanonicalEdge`, metadata field types, and the internal-key filter in
`domain/metadata_keys.py` (`is_internal_metadata_key`). `core` must not import
parsing, HTTP, or layout code.

### `data`

Parsing and normalization. `parse_newick` reads Newick trees with branch
lengths and assigns deterministic node IDs; `normalize_dataset` produces the
`CanonicalDataset`, aligns per-node metadata, and can expose the internal
metadata schema for prepare.

### `pipeline`

The heart of the server. It turns a `CanonicalDataset` into a persisted,
queryable layout:

- `ingest.py`: threshold selection and Union-Find clustering
  (`prepare_layout_artifacts`, `selected_distance_thresholds`,
  `distance_clusters`, `partition_for_threshold`, `MAX_CLUSTER_THRESHOLDS = 16`).
- `layout.py`: force-directed layout via Graphviz `sfdp`
  (`compute_prepared_layouts`, `graphviz_sfdp_positions`, `sfdp_maxiter`,
  degrade reasons). No subprocess timeout — layout runs to completion on the
  background worker.
- `models.py`: the Pydantic records (`PreparedCluster`, `PreparedEdge`,
  `ClusterLayout`, `NodeLayoutPosition`, `ViewportNode`, `ViewportEdge`,
  `ViewportReadResult`).
- `worker.py`: `PreparedLayoutWorker.prepare_dataset` orchestrates ingest →
  layout → prepared edges → persist; `submit_prepare_dataset` runs it on a
  single-worker `ThreadPoolExecutor`, and `compute_prepared_edges` builds the
  per-tier quotient edge lists.
### `services`

Application services coordinate use cases without owning HTTP transport details:
`graph_service.py` prepares datasets, maps prepare status, resolves layout
versions, and serves viewport/region/search reads.

### `repository`

Persistence implementations live behind job and layout repository modules:

- `repository/jobs/local.py`: `PrepareJobRegistry` tracks local background
  prepare `Future`s so `/prepare` can submit and clients can poll.
- `repository/jobs/postgres.py`: Postgres durable prepare-job control plane. It
  applies `sql/postgres/create-schema.sql` explicitly, records a schema checksum,
  handles duplicate submission coalescing, `FOR UPDATE SKIP LOCKED` worker
  claiming, worker leases/heartbeats, and ready/failed snapshots.
- `repository/layout/sqlite_layout_repository.py`: local SQLite artifact store.
- `repository/layout/postgres_layout_repository.py`: production/distributed
  artifact store. It mirrors the SQLite artifact tables in Postgres so API
  replicas and external workers share one database, not a filesystem volume.

### `http`

`http/graph/router.py` hosts the FastAPI routes, while
`http/graph/schemas.py` and `http/graph/responses.py` define the HTTP contract.
The router delegates application behavior to `services/graph_service.py`.

## Client Modules

### `api`

`graphClient.ts` — the typed `GraphClient` (`prepareGraph`, `readViewport`,
`readRegion`), request/response interfaces, and runtime guards
(`isGraphPrepareResponse`, `isGraphPrepareJob`, `isGraphPrepareStatus`,
`isGraphViewportResponse`).
`prepareGraph` encapsulates the async transport: it submits via
`ROUTE_GRAPH_PREPARE`, then polls `GET /prepare/{job_id}` until `ready`
(returning the `GraphPrepareResponse`) or `failed` (throwing), so callers see a
single promise. Polling cadence is governed by `DEFAULT_PREPARE_POLL_INTERVAL_MS`
and `DEFAULT_PREPARE_POLL_TIMEOUT_MS`; `httpClient.ts` gained a `get` method for
the status poll.

### `app`

`workbench/graphWorkbench.ts` is the workflow facade. `renderNewick` calls
`prepareGraph`, stores the prepared session (`datasetId`, `layoutVersion`,
`lod_tier_count`, metadata schema), and starts viewport sync through the
workbench-owned `ViewportSyncController`. It also owns display options,
metadata filters, visual mapping, node search/focus, region selection
(`selectRegion`), and the LoD-refresh
pause/resume control. The `shell/` subtree holds UI wiring — `shell/controls/`
(e.g. `visualMappingControls.ts`, which builds a `VisualMapping` from the
color-field, size-field, size-scale, and category-color controls) and
`shell/region/regionPanelView.ts` (renders the region-selection summary and its
ancillary wheel from a `readRegion` result).

### `render`

Renderer adapter layer, behind the `GraphRenderer` interface (`render/renderer.types.ts`).
The production adapter is Sigma (`render/adapters/sigma/`):

- `sigmaRenderer.ts`: adapter lifecycle, Sigma instance ownership,
  graph snapshot application, viewport state reads, camera fitting, and
  piechart-program rebuilds.
- `app/workbench/viewport/viewportSyncController.ts`: the viewport-sync engine —
  renderer view-change binding, LoD tier detection, debounced refresh, cluster
  expand/collapse, and initial fit coordination.
- `app/workbench/viewport/viewportQuery.ts`: viewport query building and the
  semantic-zoom band mapping (`semanticLodLevelForCameraRatio`,
  `semanticLodLevelForCameraRatioWithHysteresis`).
- `app/workbench/viewport/viewportSnapshot.ts`: viewport response to
  `PositionedGraph` conversion, node/edge attribute derivation, the triangle
  rule, and PHYLOViZ role coloring.
- `colorHash.ts`: the shared color source. `buildValueColorMap(values, palette)`
  ranks values by graph-wide frequency (ties broken by label) and assigns
  palette entries in order, so node fills, on-node pies, and the ancillary wheel
  all agree on a value's color. See [`CLIENT_RENDERING.md`](./CLIENT_RENDERING.md).
- `sigmaBoxSelectController.ts`: Shift+drag box-select over the canvas, driving
  the workbench's `selectRegion` / `/region` read.
- `graphViewerFit.ts`: camera fit animations.
- `sigmaAttributeUtils.ts`: attribute lookup and role normalization
  (`firstAttributeValue`, `isTruthyAttribute`, `normalizeRoleValue`).
- `sigmaRenderingConstants.ts`: color and node-type constants.

### `ancillary`

Client-side metadata indexing and filtering (`filterEngine.ts`,
`matchesFilterState`). Local-first; a server-side ancillary path is deferred
until benchmarks justify it (see [`BACKLOG.md`](./BACKLOG.md)).

## Component Map

```mermaid
flowchart TD
  subgraph Client
    WB["app/workbench/graphWorkbench.ts"]
    APIC["api/graphClient.ts"]
    RPORT["render/renderer.types.ts (GraphRenderer)"]
    SR["render/adapters/sigma/sigmaRenderer.ts"]
    VS["app/workbench/viewport/viewportSyncController.ts"]
    QRY["app/workbench/viewport/viewportQuery.ts"]
    SNAP["app/workbench/viewport/viewportSnapshot.ts"]
    FIT["render/adapters/sigma/viewport/graphViewportFit.ts"]
    FILT["ancillary/filterEngine.ts"]

    WB --> APIC
    WB --> RPORT
    WB --> VS
    VS --> APIC
    VS --> RPORT
    VS --> QRY
    VS --> SNAP
    SNAP --> FILT
    RPORT --> SR
    SR --> FIT
  end

  subgraph Server
    SRV["http/graph/router.py"]
    SVC["services/graph_service.py"]
    WORK["pipeline/worker.py<br/>(ThreadPoolExecutor)"]
    JOBS["repository/jobs/local.py<br/>(PrepareJobRegistry)"]
    ING["pipeline/ingest.py"]
    LAY["pipeline/layout.py"]
    STORE["repository/layout/*<br/>(SQLite local, Postgres distributed)"]
    DATA["data/normalizer.py + parsers.py"]

    SRV --> SVC
    SVC --> DATA
    SVC --> JOBS
    JOBS --> WORK
    WORK --> ING
    WORK --> LAY
    WORK --> STORE
    SVC --> STORE
  end

  APIC -->|"POST /api/graph/prepare"| SRV
  APIC -->|"GET /api/graph/prepare/{job_id}"| SRV
  APIC -->|"POST /api/graph/viewport"| SRV
  APIC -->|"POST /api/graph/region"| SRV
```

The `render` adapter also carries the shared color source (`colorHash.ts`,
`buildValueColorMap`) used by node fills, pies, and the wheel, and the
`sigmaBoxSelectController.ts` box-select that feeds the workbench's region read.
UI wiring (`app/shell/controls`, `app/shell/region`) is omitted from the diagram
for clarity.

Renderer adapters must not import app modules; the workbench talks to the
renderer only through the `GraphRenderer` interface. `core` must not import
parsing, HTTP, or layout code.

## Runtime Flow

```mermaid
sequenceDiagram
  participant WB as GraphWorkbench
  participant API as GraphClient
  participant Srv as Server (graph)
  participant Store as Layout Store
  participant GV as GraphViewer

  WB->>API: prepareGraph(NormalizeRequest)
  API->>Srv: POST /api/graph/prepare
  Srv->>Srv: normalize (sync); submit layout to background worker
  Srv-->>API: 202 { job_id, status: "pending" }
  loop poll until resolved
    API->>Srv: GET /api/graph/prepare/{job_id}
    Srv->>Srv: ingest -> sfdp -> prepared edges (on worker)
    Srv->>Store: persist artifacts (dataset_id, layout_version)
    Srv-->>API: { status: ready, result: GraphPrepareResponse }
  end
  API-->>WB: prepared session (lod_tier_count, layout_status)

  WB->>VS: mount viewport sync (lodTierCount)
  VS->>API: readViewport(lod_level=0, forceGlobal)
  API->>Srv: POST /api/graph/viewport
  Srv->>Store: read_viewport(...)
  Store-->>Srv: ViewportReadResult
  Srv-->>API: GraphViewportResponse (nodes, edges, truncated)
  API-->>VS: viewport slice
  VS->>Renderer: applyGraphSnapshot + fitGraphSnapshot

  loop camera pan / zoom
    VS->>VS: semanticLodLevelForCameraRatioWithHysteresis
    VS->>API: debounced readViewport(lod_level, bounds)
    API->>Srv: POST /api/graph/viewport
    Srv->>Store: read_viewport(...)
    Srv-->>VS: next slice
  end
```

## Core Contracts

Full field lists live in [`DATA_MODEL.md`](./DATA_MODEL.md); summarized here.

### `CanonicalDataset`

The normalized, correctness-first representation produced by
`normalize_dataset`: `dataset_id`, `nodes`, `edges` (with `distance`),
`metadata_schema`, `metadata_by_node_id`, and `source`. It is the input to
prepare, not the browser payload.

### `GraphViewportQuery` (client → server)

`dataset_id`, optional `layout_version`, optional `cluster_id` (cluster
expansion), optional bounds (`xmin/xmax/ymin/ymax`), `zoom`, optional
`lod_level` (0-based tier index), `max_nodes` (1–20000). Bounds are validated as
all-present-or-all-absent.

### `GraphViewportResponse` (server → client)

`dataset_id`, `layout_version`, echoed `lod_level`, `zoom`, `layout_status`,
`truncated`, `total_node_count`, `nodes` (`GraphViewportNode`), `edges`
(`GraphViewportEdge`), `global_bounds`, `metadata_schema`. `global_bounds` is
the full prepared layout's coordinate frame and stays stable across bounded
viewport reads. A cluster representative carries `is_representative = true` and
`member_count > 1`. Rerouted boundary edges carry `is_meta = true` and
`bundled_edge_count`.

## Correctness Invariants

- Same input produces deterministic normalized output and a deterministic
  `layout_version`.
- Same prepared artifacts and query produce deterministic viewport slices
  (Union-Find components are order-independent; ties break deterministically).
- Every returned edge references returned visible nodes — including meta-edges,
  which reroute to the visible representative.
- `total_node_count` is the untruncated count; `truncated` is true exactly when
  more nodes existed than were returned under `max_nodes`.
- Off-camera branches are not expanded except through an explicit `cluster_id`
  expansion request.
- Internal metadata keys (`profile_count`, `__category_count__*`) never appear
  in node, cluster, or schema payloads.
- Cluster metadata aggregation is mode for categorical/boolean, mean for
  numeric.

## Performance Model

**Prepare-time (once):** normalize; select up to 16 distance thresholds; build
Union-Find components per threshold; run `sfdp` global layout; compute cluster
positions/bounds and per-tier quotient edges; persist to the configured layout
store.

**Interaction-time (per viewport):** resolve `lod_level` from zoom/hint; run one
of four `read_viewport` paths (bounds-indexed representative or ready-node read,
overview read, or `cluster_id` expansion); attach metadata; return a
`max_nodes`-bounded slice. Viewport reads use database indexes on cluster bounds
and node positions, so cost tracks the returned slice, not total dataset size.

## Future Work

- Cache repeated viewport/zoom queries server-side.
- Tune threshold selection using projected cluster size and label density.
- Pre-cluster before `sfdp` above a node-count threshold (see
  [`BACKLOG.md`](./BACKLOG.md)).
- Add server-side ancillary filtering only if benchmarks show client-side
  filtering or metadata transfer is a bottleneck.
