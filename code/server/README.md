# PhyloLens Server

FastAPI service for deterministic phylogenetic normalization, threshold
clustering, `sfdp` layout precomputation, and bounded viewport reads backed by a
SQLite prepared-layout store. See the [`docs/`](../../docs/README.md) set for the
full architecture.

## Setup

```bash
cd code/server
pip install -e '.[test,dev]'
pre-commit install
```

To run the hook manually across the server source tree:

```bash
pre-commit run --all-files
```

## Run

```bash
uvicorn phylo_lens_server.main:app --reload
```

Or, after installation:

```bash
phylo-lens-server
```

## API

The runtime is driven by two v2 endpoints under `/api/v2/graph`. See
[`../../docs/ARCHITECTURE_SPEC.md`](../../docs/ARCHITECTURE_SPEC.md) and
[`../../docs/DATA_MODEL.md`](../../docs/DATA_MODEL.md) for full contracts.

### `GET /health`

Returns service health.

### `POST /api/v2/graph/prepare`

Normalizes input (synchronously) and submits a background job that materializes
the LoD runtime artifacts into the SQLite prepared-layout store:

- threshold clusters (up to 16 tiers) with layout-centroid representatives;
- `sfdp` force-directed node and cluster positions;
- per-tier quotient edge lists.

Because the layout can be slow on large trees, prepare is asynchronous: the route
returns `202 Accepted` immediately and the client polls for completion. The
prepare path requires weighted edges; missing distances default to `1.0` with a
warning. Request body is a `NormalizeRequest`:

```json
{
  "format": "newick",
  "dataset_name": "example-tree",
  "content": "(A:1,(B:2,C:4)N:3)R;"
}
```

The response (`GraphV2PrepareJob`) is `{ "job_id": ..., "status": "pending",
"dataset_id": ... }`.

### `GET /api/v2/graph/prepare/{job_id}`

Polls a prepare job. Returns `GraphV2PrepareStatus` with `status` of `pending`,
`ready`, or `failed`. When `ready`, the full `GraphV2PrepareResponse` is under
`result` (`dataset_id`, `layout_version`, node/edge/cluster counts,
`lod_tier_count`, `layout_status`, `warnings`); when `failed`, `error` carries
the reason. Unknown `job_id` returns `404`.

### `POST /api/v2/graph/viewport`

Returns a bounded visible graph slice for a prepared dataset.

```json
{
  "dataset_id": "example-tree",
  "layout_version": "…",
  "xmin": 0, "xmax": 1000, "ymin": 0, "ymax": 600,
  "zoom": 2.0,
  "lod_level": 1,
  "max_nodes": 2500
}
```

The response (`GraphViewportResponse`) includes visible nodes, visible edges
(with meta-edge fields for expanded clusters), `total_node_count`, `truncated`,
and `metadata_schema`. Set `cluster_id` to expand a single cluster into its
members.

## Storage

Prepared layouts are persisted through `PreparedLayoutStore`, a SQLite database
keyed by `(dataset_id, layout_version)`. See the schema in
[`../../docs/DATA_MODEL.md`](../../docs/DATA_MODEL.md).

Environment variable:

- `PHYLO_LENS_PREPARED_LAYOUT_STORE_DIR`: store directory. Defaults to
  a `phylo_lens_prepared_layout` directory under the system temp dir.

## Tests

```bash
pytest -q
```
