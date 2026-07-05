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

## Endpoint reference

Runnable examples against a local server (`http://localhost:8000`). The API is
**unauthenticated** — there is no `Authorization` header. The three interaction
routes are `POST` with a JSON body (not path-param `GET`s), because each carries
a structured query (a dataset, a viewport, a region) rather than a single id.
Field-level model tables follow in [Request/response models](#requestresponse-models).

### `GET /health`

**Description:** Liveness probe for local runs and CI.

**Request:** no body.

```bash
curl --location --request GET 'http://localhost:8000/health'
```

**Success — `200 OK`** (`application/json`):

```json
{ "status": "ok" }
```

### `POST /api/graph/prepare`

**Description:** Normalize + validate a dataset synchronously, then submit the
force-directed layout as a background job. Returns immediately; poll the status
route until the layout is `ready`.

**Request** (`application/json`) — a `NormalizeRequest`. Only `format`,
`content` are required; metadata/ancillary fields are optional:

```json
{
  "format": "newick",
  "dataset_name": "example-tree",
  "content": "(A:1,(B:2,C:4)N:3)R;"
}
```

```bash
curl --location --request POST 'http://localhost:8000/api/graph/prepare' \
  --header 'Content-Type: application/json' \
  --data-raw '{ "format": "newick", "dataset_name": "example-tree", "content": "(A:1,(B:2,C:4)N:3)R;" }'
```

**Success — `202 Accepted`** (`application/json`) — a `GraphPrepareJob`:

```json
{ "job_id": "…", "status": "pending", "dataset_id": "example-tree" }
```

**Error responses:** `400` (malformed Newick) · `422` (schema/domain validation).

### `GET /api/graph/prepare/{job_id}`

**Description:** Poll a prepare job. Repeat until `status` is `ready` or `failed`.

**URI params:** `job_id` (`str`) — the id returned by `POST /prepare`.

```bash
curl --location --request GET 'http://localhost:8000/api/graph/prepare/JOB_ID'
```

**Success — `200 OK`** (`application/json`) — a `GraphPrepareStatus`. When
`ready`, the full `GraphPrepareResponse` is nested under `result`:

```json
{
  "job_id": "…",
  "status": "ready",
  "result": {
    "dataset_id": "example-tree",
    "layout_version": "…",
    "node_count": 5,
    "edge_count": 4,
    "cluster_count": 2,
    "lod_tier_count": 1,
    "layout_status": "ready",
    "warnings": []
  }
}
```

**Error responses:** `404` (unknown `job_id`).

### `POST /api/graph/viewport`

**Description:** Read a bounded, LoD-appropriate slice of a prepared dataset for
the current camera. Bounds are all-present-or-all-absent; omit them for the
tier-0 overview.

**Request** (`application/json`) — a `GraphViewportQuery`:

```bash
curl --location --request POST 'http://localhost:8000/api/graph/viewport' \
  --header 'Content-Type: application/json' \
  --data-raw '{ "dataset_id": "example-tree", "layout_version": "…", "xmin": 0, "xmax": 1000, "ymin": 0, "ymax": 600, "zoom": 2.0, "lod_level": 1, "max_nodes": 2500 }'
```

**Success — `200 OK`** (`application/json`) — a `GraphViewportResponse`:

```json
{
  "dataset_id": "example-tree",
  "layout_version": "…",
  "lod_level": 1,
  "zoom": 2.0,
  "layout_status": "ready",
  "truncated": false,
  "total_node_count": 5,
  "nodes": [ { "id": "A", "cluster_id": "c0", "x": 12.3, "y": 45.6, "layout_status": "ready", "member_count": 1 } ],
  "edges": [ { "id": "A->N", "source": "A", "target": "N", "distance": 1.0 } ],
  "metadata_schema": []
}
```

**Error responses:** `404` (dataset/layout not found) · `422` (partial bounds,
or `max_nodes` out of `1..20000`).

### `POST /api/graph/region`

**Description:** Read the finest-detail subgraph inside a hand-drawn box, plus a
one-shot metadata summary for the selection. Always full detail — takes no
`zoom`/`lod_level`.

**Request** (`application/json`) — a `GraphRegionQuery`; all four bounds
required:

```bash
curl --location --request POST 'http://localhost:8000/api/graph/region' \
  --header 'Content-Type: application/json' \
  --data-raw '{ "dataset_id": "example-tree", "layout_version": "…", "xmin": 0, "xmax": 500, "ymin": 0, "ymax": 300, "max_nodes": 2500 }'
```

**Success — `200 OK`** (`application/json`) — a `GraphRegionResponse` (viewport
shape minus `lod_level`/`zoom`, plus `aggregated_metadata`):

```json
{
  "dataset_id": "example-tree",
  "layout_version": "…",
  "layout_status": "ready",
  "truncated": false,
  "total_node_count": 3,
  "nodes": [ { "id": "B", "cluster_id": "c1", "x": 20.0, "y": 30.0, "layout_status": "ready", "member_count": 1 } ],
  "edges": [],
  "metadata_schema": [ { "key": "region", "type": "string" } ],
  "aggregated_metadata": { "region": "EU" }
}
```

**Error responses:** `404` (dataset/layout not found) · `422` (`xmax < xmin` or
`ymax < ymin`, or `max_nodes` out of range).

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
