# API Reference — `/api/graph`

Field-level reference for the PhyloLens HTTP API. For the system map see
[`ARCHITECTURE_SPEC.md`](./ARCHITECTURE_SPEC.md); for the runtime narrative see
[`flow.md`](./flow.md); for internal models see [`DATA_MODEL.md`](./DATA_MODEL.md).

All routes live under the prefix **`/api/graph`** (`ROUTER_PREFIX`,
`api/graph.py`). Request/response models are Pydantic (server) mirrored by
TypeScript interfaces in `code/client/src/api/graphClient.ts`. Responses use
`response_model_exclude_none=True`, so `null`-valued optional fields are omitted
from the JSON.

## Route summary

| Method | Path | Request | Response | Success |
|---|---|---|---|---|
| `POST` | `/prepare` | `NormalizeRequest` | `GraphPrepareJob` | `202` |
| `GET` | `/prepare/{job_id}` | — | `GraphPrepareStatus` | `200` |
| `POST` | `/viewport` | `GraphViewportQuery` | `GraphViewportResponse` | `200` |
| `POST` | `/region` | `GraphRegionQuery` | `GraphRegionResponse` | `200` |

Prepare + viewport are the core interaction loop; region is an on-demand read for
a hand-drawn selection box. There is no standalone `normalize` route —
normalization is a synchronous step inside `prepare`.

## Lifecycle: prepare → poll → viewport

Global layout (Graphviz `sfdp`) runs on a background worker, so `prepare` is
asynchronous:

1. **`POST /prepare`** normalizes + validates the dataset **synchronously** (bad
   input fails fast with `4xx`), submits the layout job, and returns `202` with a
   `GraphPrepareJob` (`job_id`, `status: "pending"`, `dataset_id`).
2. The client **polls `GET /prepare/{job_id}`** until `status` is `ready` or
   `failed`. Cadence is client-side: `DEFAULT_PREPARE_POLL_INTERVAL_MS = 1000`
   (1s between polls), `DEFAULT_PREPARE_POLL_TIMEOUT_MS = 600_000` (10-min budget).
3. When `ready`, the status response carries the full `GraphPrepareResponse`
   under `result` (including `layout_version` and `lod_tier_count`). The client
   then drives **`POST /viewport`** for each camera change, and **`POST /region`**
   for box selections.

## Constants

| Constant | Value | Meaning |
|---|---|---|
| `DEFAULT_MAX_VIEWPORT_NODES` | `2500` | Default `max_nodes` for viewport/region |
| `HARD_MAX_VIEWPORT_NODES` | `20000` | Upper bound accepted for `max_nodes` |
| `DEFAULT_PREPARE_POLL_INTERVAL_MS` | `1000` | Client poll interval |
| `DEFAULT_PREPARE_POLL_TIMEOUT_MS` | `600000` | Client poll timeout budget |

**Input format:** `NormalizeRequest.format` accepts **`"newick"`** only
(`NormalizeFormat.NEWICK`). The edge-list format was removed. `typing_data` is
reserved in `SourceFormat` but not yet wired into the normalize path (see
`BACKLOG.md` item 4 for the planned Phylolib route).

**Layout status** (`LayoutStatus`, server): `pending | refining | ready |
degraded | failed`. A `degraded` layout is a real result on a fallback
(circular/jittered) placement; it is still renderable and is surfaced via
`warnings`. (The client `GraphLayoutStatus` type currently omits `degraded`.)

## Errors

Error bodies follow FastAPI's `{"detail": ...}` convention (`api/errors.py`):

| Code | When | `detail` shape |
|---|---|---|
| `400` | Parse failure (malformed Newick) | `str` (message) |
| `404` | Unknown `job_id`, or dataset/layout not found | `str` (message) |
| `422` | Domain validation (e.g. missing distances) | `{"errors": [str, ...]}` |
| `422` | Request-schema validation (Pydantic) | `{"errors": [ {loc,msg,type}, ... ]}` |
| `500` | Unhandled exception | `"Unexpected server error"` |

---

## Request/response models

### `NormalizeRequest` — body of `POST /prepare`

| Field | Type | Default | Notes |
|---|---|---|---|
| `format` | `"newick"` | — | only Newick is accepted |
| `dataset_name` | `str` (min 1) | `"dataset"` | |
| `content` | `str` (min 1) | — | raw Newick text |
| `options` | `NormalizeOptions` | `{}` | `{ allow_self_loops: bool = false }` |
| `metadata_schema` | `MetadataField[]` | `[]` | each `{ key, type }`; `type` ∈ `string\|number\|boolean\|null` |
| `metadata_by_node_id` | `dict[str, dict[str, str\|float\|bool\|null]]` | `{}` | per-node metadata |
| `ancillary_data` | `AncillaryDataRequest \| null` | `null` | `{ content, join_column, format: "auto"\|"csv"\|"tsv" }` — joined by `join_column` |

### `GraphPrepareJob` — `202` from `POST /prepare`

`job_id: str` · `status: str` (`"pending"`) · `dataset_id: str`

### `GraphPrepareStatus` — from `GET /prepare/{job_id}`

`job_id: str` · `status: str` (`pending\|ready\|failed`) ·
`result: GraphPrepareResponse \| null` (only when `ready`) ·
`error: str \| null` (only when `failed`)

### `GraphPrepareResponse` — nested under `result`

| Field | Type | Notes |
|---|---|---|
| `dataset_id` | `str` | |
| `layout_version` | `str` | pass to viewport/region to pin a version |
| `node_count` | `int ≥ 0` | |
| `edge_count` | `int ≥ 0` | |
| `cluster_count` | `int ≥ 0` | |
| `lod_tier_count` | `int ≥ 1` (default `1`) | distinct LoD tiers; `1` = finest only |
| `layout_status` | `LayoutStatus` | |
| `warnings` | `str[]` | e.g. distance/degrade notices |

### `GraphViewportQuery` — body of `POST /viewport`

| Field | Type | Default | Notes |
|---|---|---|---|
| `dataset_id` | `str` (min 1) | — | |
| `layout_version` | `str \| null` | `null` | latest if omitted |
| `cluster_id` | `str \| null` | `null` | expand a single cluster's members |
| `xmin/xmax/ymin/ymax` | `float \| null` | `null` | **all present or all absent** (validated) |
| `zoom` | `float ≥ 0` | `1.0` | |
| `lod_level` | `int ≥ 0 \| null` | `null` | 0-based tier; derived from `zoom` if `null` |
| `max_nodes` | `int` | `2500` | `1 ≤ n ≤ 20000` |

### `GraphViewportResponse` — from `POST /viewport`

`dataset_id` · `layout_version` · `lod_level: int\|null` · `zoom: float` ·
`layout_status` · `truncated: bool` · `total_node_count: int` ·
`nodes: GraphViewportNode[]` · `edges: GraphViewportEdge[]` ·
`metadata_schema: GraphMetadataField[]`

**`GraphViewportNode`:** `id` · `cluster_id` · `x` · `y` · `layout_status` ·
`member_count: int ≥ 1` (default 1) · `is_representative: bool` (default false) ·
`metadata: dict \| null`.

**`GraphViewportEdge`:** `id` · `source` · `target` · `distance: float\|null` ·
`is_meta: bool\|null` (rerouted boundary edge of a collapsed cluster) ·
`bundled_edge_count: int\|null` (edges bundled into a meta-edge).

**`GraphMetadataField`:** `key: str` · `type: str`.

### `GraphRegionQuery` — body of `POST /region`

`dataset_id` (min 1) · `layout_version: str\|null` · **required** `xmin`, `xmax`,
`ymin`, `ymax` (`float`; validated `xmax ≥ xmin`, `ymax ≥ ymin`) · `max_nodes`
(default `2500`, `1..20000`). Unlike viewport, region takes **no** `zoom`/
`lod_level` — it always reads finest-detail nodes inside the box.

### `GraphRegionResponse` — from `POST /region`

Same shape as `GraphViewportResponse` minus `lod_level`/`zoom`, plus
**`aggregated_metadata: dict[str, str\|float\|bool\|null]`** — the region's
summary: **mode** for categorical/boolean fields, **mean** for numeric (nulls
excluded). Powers the region-selection stats panel.

---

## Client consumption (`graphClient.ts`)

- `prepareGraph(http, request, options?)` → submits then polls, resolving to the
  ready `GraphPrepareResponse`. `options`: `pollIntervalMs`, `pollTimeoutMs`,
  `onPending` (progress callback), injectable `sleep`.
- `submitPrepareGraph` / `pollPrepareGraph` / `getPrepareGraphStatus` — the
  same flow decomposed if you need manual control of the poll loop.
- `readGraphViewport(http, query)` / `readGraphRegion(http, query)` — the two
  interactive reads; each validates the response against a runtime type guard and
  throws `ERR_INVALID_GRAPH_*_RESPONSE` on contract violations.

## How the library is meant to be consumed

The API is a **prepare-once, read-many** contract built around three assumptions:

1. **Precompute is amortized.** Callers `prepare` a dataset once (paying the
   layout cost on the worker), keep the returned `layout_version`, and issue many
   cheap bounded reads against it. Persisting `layout_version` client-side lets a
   session reconnect to the same materialized layout without re-preparing.
2. **The client drives LoD, the server serves slices.** A viewer maps camera zoom
   to a `lod_level` (0..`lod_tier_count-1`) and viewport bounds, then calls
   `/viewport`. The server never pushes; every read is a pull bounded by
   `max_nodes`, with `truncated`/`total_node_count` telling the client whether it
   is seeing a slice. This keeps payloads flat regardless of dataset size.
3. **Metadata travels with nodes; aggregation is server-side.** Per-node
   `metadata` and the `metadata_schema` ride along in viewport reads so the client
   can color/size/filter locally; region reads additionally return
   `aggregated_metadata` so a selection summary needs no second round-trip.

Non-viewer integrations (scripts, notebooks, other tools) can consume the same
contract directly: `POST /prepare` → poll `/prepare/{job_id}` → `POST /viewport`
with an explicit `lod_level` and `max_nodes` to pull a bounded, LoD-appropriate
subgraph, or `POST /region` with bounds to extract an isolated subgraph plus its
aggregate stats. Because every response is a plain bounded JSON graph
(`nodes` + `edges` + `metadata`), the API doubles as a headless query surface over
the prepared layout, not only a backend for the bundled UI.
