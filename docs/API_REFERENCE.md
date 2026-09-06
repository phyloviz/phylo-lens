# HTTP API reference

This document defines the public PhyloLens service contract. It is intended for
host applications that call the service directly, integration tests, and
operators diagnosing browser/service compatibility.

The browser package normally hides this protocol behind
`createPhyloLensView()`. See the [browser library README](../code/client/README.md)
for the supported integration API.

## Contract and media type

- service information: `GET /health`;
- graph routes: `/api/graph/*`;
- request and response media type: `application/json`;
- authentication: not implemented by the service;
- browser credentials/cookies: disabled;
- current API contract version: `1`.

Optional response fields with `None` values are omitted on graph routes.

## Route summary

| Method | Path | Request | Response | Success |
| --- | --- | --- | --- | --- |
| `GET` | `/health` | — | service information | `200` |
| `POST` | `/api/graph/prepare` | `NormalizeRequest` | `GraphPrepareJob` | `202` |
| `GET` | `/api/graph/prepare/{job_id}` | — | `GraphPrepareStatus` | `200` |
| `POST` | `/api/graph/viewport` | `GraphViewportQuery` | `GraphViewportResponse` | `200` |
| `POST` | `/api/graph/region` | `GraphRegionQuery` | `GraphRegionResponse` | `200` |
| `POST` | `/api/graph/search` | `GraphSearchQuery` | `GraphSearchResponse` | `200` |
| `PUT` | `/api/graph/ancillary` | `GraphAncillaryRequest` | `GraphAncillaryResponse` | `200` |

## Prepare lifecycle

Preparation is asynchronous because layout and LoD materialization are global,
potentially expensive operations.

```text
POST /api/graph/prepare
    → 202 { job_id, status: "pending", dataset_id }

GET /api/graph/prepare/{job_id}
    → pending
    → ready { result: GraphPrepareResponse }
    → failed { error }
```

Normalization happens before the job is accepted. Malformed input and metadata
validation errors therefore fail directly on `POST /prepare`. Once a job is
ready, callers use its `dataset_id` and `layout_version` for viewport, region,
and search requests.

The browser package polls every `1000 ms` with a default client-side timeout of
`600000 ms`. These values are client implementation defaults, not server
contract fields.

## Error responses

FastAPI errors use a top-level `detail` field.

| Status | Typical cause | Shape |
| --- | --- | --- |
| `400` | Malformed Newick, invalid ancillary table, unavailable/failed PhyloLib typing conversion | `{ "detail": "message" }` |
| `404` | Unknown job or no published layout for the requested dataset/version | `{ "detail": "message" }` |
| `422` | Request-schema validation | FastAPI validation detail list |
| `422` | Domain invariant failure | `{ "detail": { "errors": ["..."] } }` |
| `429` | Local active-job capacity reached | `{ "detail": "message" }` |
| `500` | Unhandled service failure | `{ "detail": "Unexpected server error" }` |

A failed background job is reported as `200` from the status endpoint with
`status: "failed"` and an `error` string. This distinguishes job failure from a
transport or route failure.

---

## `GET /health`

Returns liveness and compatibility information. The browser package checks this
endpoint before the first preparation request.

### Request

No body.

```bash
curl http://localhost:8000/health
```

### Response — `200 OK`

```json
{
  "status": "ok",
  "service_version": "0.2.1",
  "api_version": "1"
}
```

| Field | Type | Description |
| --- | --- | --- |
| `status` | `"ok"` | Liveness indicator used by container health checks |
| `service_version` | `string` | Python/Docker implementation release |
| `api_version` | `string` | Compatibility contract used by the browser package |

Compatibility depends on `api_version`, not on equality between npm and service
implementation versions.

---

## `POST /api/graph/prepare`

Normalizes input and submits preparation of a persisted layout.

### Request — `NormalizeRequest`

```json
{
  "format": "newick",
  "dataset_name": "example-tree",
  "content": "(A:1,(B:2,C:4)N:3)R;",
  "options": {
    "allow_self_loops": false
  },
  "metadata_schema": [],
  "metadata_by_node_id": {},
  "ancillary_data": null
}
```

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `format` | `"newick" \| "typing_data"` | yes | — | Input family |
| `dataset_name` | non-empty `string` | no | `"dataset"` | Dataset identifier and layout namespace |
| `content` | non-empty `string` | yes | — | Newick text or allelic-profile matrix |
| `options.allow_self_loops` | `boolean` | no | `false` | Permit self-loop edges during domain validation |
| `metadata_schema` | `MetadataField[]` | no | `[]` | Declared public metadata types |
| `metadata_by_node_id` | object | no | `{}` | Direct metadata keyed by canonical node ID |
| `ancillary_data` | `AncillaryDataRequest \| null` | no | `null` | CSV/TSV metadata joined to nodes |

`MetadataField`:

| Field | Type |
| --- | --- |
| `key` | non-empty `string` |
| `type` | `"string" \| "number" \| "boolean" \| "null"` |

`AncillaryDataRequest`:

| Field | Type | Required | Default |
| --- | --- | --- | --- |
| `content` | non-empty `string` | yes | — |
| `join_column` | non-empty `string` | yes | — |
| `format` | `"auto" \| "csv" \| "tsv"` | no | `"auto"` |

Direct metadata takes precedence over ancillary metadata when both define the
same field for the same node. Reserved internal metadata keys are rejected.
Detailed normalization rules are documented in [Input formats](INPUT_FORMATS.md).

### Newick example

```bash
curl -X POST http://localhost:8000/api/graph/prepare \
  -H 'Content-Type: application/json' \
  -d '{
    "format": "newick",
    "dataset_name": "example-tree",
    "content": "(A:1,(B:2,C:4)N:3)R;"
  }'
```

### Typing-data example

```bash
curl -X POST http://localhost:8000/api/graph/prepare \
  -H 'Content-Type: application/json' \
  -d @- <<'JSON'
{
  "format": "typing_data",
  "dataset_name": "mlst-profiles",
  "content": "ST\tadk\tfumC\nA\t1\t2\nB\t1\t3\nC\t4\t5\n"
}
JSON
```

### Response — `202 Accepted`

```json
{
  "job_id": "7b97d49d5ec848e2a59c30e344d836cb",
  "status": "pending",
  "dataset_id": "example-tree"
}
```

### Reuse semantics

The service derives a `layout_version` fingerprint from the canonical dataset,
including topology, distances, metadata, ancillary rows, source semantics, and
the explicit layout-pipeline version. Identical submissions may reuse an active
or completed job. A metadata change produces a different layout version.

---

## `GET /api/graph/prepare/{job_id}`

Polls an asynchronous preparation job.

### Pending response

```json
{
  "job_id": "7b97d49d5ec848e2a59c30e344d836cb",
  "status": "pending"
}
```

### Ready response

```json
{
  "job_id": "7b97d49d5ec848e2a59c30e344d836cb",
  "status": "ready",
  "result": {
    "dataset_id": "example-tree",
    "layout_version": "88dbd97cd8f53fe6",
    "node_count": 5,
    "edge_count": 4,
    "cluster_count": 7,
    "lod_tier_count": 3,
    "layout_status": "ready",
    "warnings": []
  }
}
```

### Failed response

```json
{
  "job_id": "7b97d49d5ec848e2a59c30e344d836cb",
  "status": "failed",
  "error": "Graphviz 'sfdp' timed out while computing the force-directed layout.",
  "error_details": {
    "algorithm": "sfdp",
    "stage": "global_layout",
    "exit_status": null,
    "timeout_seconds": 900,
    "stderr": null,
    "detail": "The explicitly configured sfdp timeout elapsed."
  }
}
```

`error_details` is included for layout failures where available. It identifies
the requested algorithm and failure stage, then preserves the subprocess exit
status, explicit timeout, stderr, and error detail when those values exist.

### `GraphPrepareResponse`

| Field | Type | Description |
| --- | --- | --- |
| `dataset_id` | `string` | Prepared dataset identifier |
| `layout_version` | `string` | Content-derived prepared-layout version |
| `node_count` | non-negative `integer` | Canonical node count |
| `edge_count` | non-negative `integer` | Canonical edge count |
| `cluster_count` | non-negative `integer` | Number of materialized cluster records across tiers |
| `lod_tier_count` | integer ≥ 1 | Number of semantic-zoom tiers |
| `layout_status` | `LayoutStatus` | `ready` for a successful current preparation |
| `warnings` | `string[]` | Normalization, ancillary, distance, or forest warnings |

`LayoutStatus` is one of:

```text
pending | refining | ready | degraded | failed
```

Current preparation publishes only `ready` layouts. `degraded` remains readable
for layouts made by earlier service versions; it is not produced as a fallback
by the current `sfdp` pipeline.

---

## `POST /api/graph/viewport`

Returns the graph subset required for a semantic-zoom tier and optional camera
bounds.

### Request — `GraphViewportQuery`

```json
{
  "dataset_id": "example-tree",
  "layout_version": "88dbd97cd8f53fe6",
  "xmin": -100,
  "xmax": 100,
  "ymin": -80,
  "ymax": 80,
  "zoom": 2.0,
  "lod_level": 1,
  "max_nodes": 2500
}
```

| Field | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `dataset_id` | non-empty `string` | yes | — | Prepared dataset |
| `layout_version` | `string \| null` | no | latest published | Pins one layout version |
| `cluster_id` | `string \| null` | no | `null` | Expands one prepared cluster |
| `focus_node_id` | `string \| null` | no | `null` | Requests a slice containing a searched node |
| `xmin`, `xmax`, `ymin`, `ymax` | `number \| null` | no | absent | All four must be present together |
| `zoom` | number ≥ 0 | no | `1.0` | Echoed display zoom; used only when `lod_level` is omitted |
| `lod_level` | integer ≥ 0 or `null` | no | `null` | Zero-based LoD tier, coarse to fine |
| `max_nodes` | integer 1–20000 | no | `2500` | Primary slice budget |

When `lod_level` is omitted, the service uses a minimal fallback rule:
`zoom < 1.0` selects tier `0`; otherwise the finest path is requested. The
browser library normally calculates `lod_level` explicitly from camera ratio.

Bounds are ignored for explicit cluster expansion so the complete cluster can be
returned. Edge-preserving neighbour nodes and expansion results can make the
returned node count exceed the primary `max_nodes` read.

### Response — `GraphViewportResponse`

```json
{
  "dataset_id": "example-tree",
  "layout_version": "88dbd97cd8f53fe6",
  "lod_level": 1,
  "zoom": 2.0,
  "layout_status": "ready",
  "truncated": false,
  "total_node_count": 5,
  "nodes": [
    {
      "id": "a",
      "cluster_id": "distance_cluster_1_a_1f8c4b6b2d",
      "x": 12.3,
      "y": 45.6,
      "layout_status": "ready",
      "member_count": 1,
      "is_representative": false,
      "metadata": { "country": "Portugal" }
    }
  ],
  "edges": [
    {
      "id": "e_r_a_1",
      "source": "r",
      "target": "a",
      "distance": 1.0
    }
  ],
  "global_bounds": {
    "min_x": -120.0,
    "max_x": 120.0,
    "min_y": -80.0,
    "max_y": 80.0
  },
  "metadata_schema": [
    { "key": "country", "type": "string" }
  ]
}
```

`GraphViewportNode`:

| Field | Type | Description |
| --- | --- | --- |
| `id` | `string` | Visible node or representative identifier |
| `cluster_id` | `string` | Prepared cluster containing the node at the selected tier |
| `x`, `y` | `number` | Global prepared-layout coordinates |
| `layout_status` | `LayoutStatus` | Status of the stored position |
| `member_count` | integer ≥ 1 | Number of underlying nodes represented |
| `is_representative` | `boolean` | Whether the node is acting as a cluster representative |
| `metadata` | object or omitted | Render metadata for the node or cluster. It includes caller-visible fields and may include internal aggregation keys that are absent from `metadata_schema`. |

`GraphViewportEdge`:

| Field | Type | Description |
| --- | --- | --- |
| `id` | `string` | Stable edge identifier for this response path |
| `source`, `target` | `string` | Returned node identifiers |
| `distance` | `number \| null` | Branch or minimum bundled distance |
| `is_meta` | `boolean \| null` | True for rerouted expansion boundary edges |
| `bundled_edge_count` | `integer \| null` | Original boundary edges represented by a meta-edge |

`global_bounds` is the full prepared coordinate frame, not the bounds of the
current slice. It lets the renderer preserve one camera coordinate system across
viewport replacements.

`total_node_count` is the untruncated count for the primary query path.
`truncated` indicates that the requested slice exceeded its budget.

---

## `POST /api/graph/region`

Reads a finest-detail rectangular subgraph and computes one metadata summary for
the selection.

### Request — `GraphRegionQuery`

```json
{
  "dataset_id": "example-tree",
  "layout_version": "88dbd97cd8f53fe6",
  "xmin": -20,
  "xmax": 20,
  "ymin": -15,
  "ymax": 15,
  "max_nodes": 2500
}
```

| Field | Type | Required | Default |
| --- | --- | --- | --- |
| `dataset_id` | non-empty `string` | yes | — |
| `layout_version` | `string \| null` | no | latest published |
| `xmin`, `xmax`, `ymin`, `ymax` | `number` | yes | — |
| `max_nodes` | integer 1–20000 | no | `2500` |

`xmax` must be greater than or equal to `xmin`; `ymax` must be greater than or
equal to `ymin`.

### Response — `GraphRegionResponse`

The response contains the viewport node, edge, status, truncation and metadata
schema fields, plus:

```json
{
  "aggregated_metadata": {
    "country": "Portugal",
    "year": 2023.5
  }
}
```

Aggregation rules:

- numeric fields: mean of non-null values;
- string and boolean fields: mode with deterministic tie-breaking;
- internal metadata keys: excluded.

---

## `POST /api/graph/search`

Searches canonical node identifiers and public metadata values across a prepared
layout.

### Request — `GraphSearchQuery`

```json
{
  "dataset_id": "example-tree",
  "layout_version": "88dbd97cd8f53fe6",
  "query": "portugal",
  "limit": 25
}
```

| Field | Type | Required | Default |
| --- | --- | --- | --- |
| `dataset_id` | non-empty `string` | yes | — |
| `layout_version` | `string \| null` | no | latest published |
| `query` | non-empty `string` | yes | — |
| `limit` | integer 1–500 | no | `25` |

Search is case-insensitive. Ranking is deterministic:

| Match | Score |
| --- | ---: |
| Exact node ID | 100 |
| Node-ID prefix | 60 |
| Node-ID substring | 40 |
| Public metadata value substring | 20 |

Generated anonymous union-node IDs and internal metadata fields are excluded.

### Response — `GraphSearchResponse`

```json
{
  "dataset_id": "example-tree",
  "layout_version": "88dbd97cd8f53fe6",
  "query": "portugal",
  "matches": [
    {
      "node_id": "p09",
      "score": 20,
      "matched_text": "p09 Portugal",
      "cluster_id": "distance_cluster_1_p09_...",
      "x": 10.5,
      "y": -3.2
    }
  ],
  "total_count": 1
}
```

Coordinates allow the browser library to request and focus a slice containing a
result that is outside the current viewport.

## Direct protocol use

The service is a prepare-once, read-many API:

1. submit one preparation request;
2. poll until ready;
3. retain `dataset_id` and `layout_version`;
4. issue many bounded viewport, region, and search reads.

Scripts and notebooks may use the protocol directly. Browser integrations should
prefer `@phyloviz/phylo-lens`, which validates responses at runtime and owns the
polling and viewport lifecycle.


## Apply ancillary data to a prepared layout

`PUT /api/graph/ancillary` accepts an exact published source version:

```json
{
  "dataset_id": "tree",
  "layout_version": "existing-version",
  "ancillary_data": {
    "format": "csv",
    "join_column": "id",
    "content": "id,country\nA,Portugal\nB,Canada\n"
  }
}
```

`format` is `auto` (default), `csv`, or `tsv`. The source must be `ready` or
`degraded`. Joins use persisted canonical IDs, with the initial-import label slug
fallback. Original source-label provenance is not stored, so this endpoint accepts
persisted IDs rather than re-parsing the original Newick or typing input.
Repeated rows use the same aggregation rules as initial ancillary import.

Success (`200`) is synchronous:

```json
{
  "dataset_id": "tree",
  "layout_version": "new-version",
  "matched_node_count": 2,
  "warnings": []
}
```

The returned version contains the replacement node metadata and public schema.
All previous metadata fields are replaced, including directly supplied metadata;
unmatched nodes have no replacement metadata. The source version is unchanged.
Use the returned version for subsequent viewport, search, and region requests.
The update reuses stored geometry and cluster memberships and rebuilds cluster
metadata summaries. It does not invoke normalization of the tree, PhyloLib,
Graphviz, or LoD construction.

Invalid tables, reserved metadata columns, and tables matching no nodes return
`400`. Missing or unpublished source versions return `404`; invalid request
shapes return `422`. Unmatched rows and nodes are reported in `warnings` when at
least one node matches. Publication is transactional: a failed write leaves no
partial version. Repeating the same source version and normalized table returns
the same derived version, including concurrent identical requests.

This operation copies persisted geometry into a new immutable version. Its cost
includes table parsing, database copying, and metadata aggregation, and it consumes
additional storage. Large uploads can take time even though layout computation is
skipped. No new prepare job is submitted.
