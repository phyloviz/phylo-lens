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

## Docker

The PhyloLens API service is packaged separately from the browser library. A
host application deploys this service and passes its URI to the npm package as
`apiUrl`.

Build the image from the server directory:

```bash
cd code/server
docker build -t ghcr.io/phyloviz/phylo-lens-service:0.1.0 .
```

Run it locally:

```bash
docker run --rm \
  -p 8000:8000 \
  -v phylo-lens-data:/data \
  ghcr.io/phyloviz/phylo-lens-service:0.1.0
```

The container listens on port `8000`, binds to `0.0.0.0`, and writes prepared
layout data under `/data`. The image includes Python 3.12, the server package,
FastAPI/uvicorn, SQLite from the Python standard library, Graphviz `sfdp`, and
the PhyloLib Java runtime from the digest-pinned PhyloLib image. Production
`typing_data` ingest runs `java -jar /app.jar` inside this service container; it
does not need host Docker access.

Bundled PhyloLib runtime:

- Java: Eclipse Temurin OpenJDK `21.0.11+10-LTS`.
- PhyloLib source image:
  `gonfrutuoso/phylolib@sha256:fddd67d0c00c1920c81b395155d13dfa99b546d6c7c47c6e92713e3a3fed834b`.
- PhyloLib JAR path: `/app.jar`.
- PhyloLib JAR SHA-256:
  `36ae96903da88a2c41df6bdc266da0a2485f2278ecc473b60287c43e6163e70f`.

Typing-data ingest uses a temporary working directory and runs:

```bash
java -jar /app.jar distance hamming \
  --dataset=ml:/tmp/phylolib-.../profiles.txt \
  --out=symmetric:/tmp/phylolib-.../matrix.txt

java -jar /app.jar algorithm goeburst \
  --matrix=symmetric:/tmp/phylolib-.../matrix.txt \
  --out=newick:/tmp/phylolib-.../tree.nwk \
  --lvs=3
```

Health check:

```bash
curl http://localhost:8000/health
# {"status":"ok"}
```

Local Compose usage:

```bash
cd code/server
docker compose up --build
```

Container smoke validation:

```bash
cd code/server
./scripts/container-smoke.sh
```

## API

The runtime is driven by two endpoints under `/api/graph`. See
[`../../docs/ARCHITECTURE_SPEC.md`](../../docs/ARCHITECTURE_SPEC.md) and
[`../../docs/DATA_MODEL.md`](../../docs/DATA_MODEL.md) for full contracts.

### `GET /health`

Returns service health.

### `POST /api/graph/prepare`

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

The response (`GraphPrepareJob`) is `{ "job_id": ..., "status": "pending",
"dataset_id": ... }`.

### `GET /api/graph/prepare/{job_id}`

Polls a prepare job. Returns `GraphPrepareStatus` with `status` of `pending`,
`ready`, or `failed`. When `ready`, the full `GraphPrepareResponse` is under
`result` (`dataset_id`, `layout_version`, node/edge/cluster counts,
`lod_tier_count`, `layout_status`, `warnings`); when `failed`, `error` carries
the reason. Unknown `job_id` returns `404`.

### `POST /api/graph/viewport`

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

- `PHYLO_LENS_DATA_DIR`: deployment data root. When set, prepared layouts are
  stored below `${PHYLO_LENS_DATA_DIR}/prepared_layout`. The Docker image sets
  this to `/data`.
- `PHYLO_LENS_PREPARED_LAYOUT_STORE_DIR`: store directory. Defaults to
  a `phylo_lens_prepared_layout` directory under the system temp dir when
  `PHYLO_LENS_DATA_DIR` is unset. If both variables are set, this explicit store
  directory wins.
- `PHYLO_LENS_PHYLOLIB_JAR`: path to the bundled PhyloLib JAR for
  `typing_data` ingest. The Docker image sets this to `/app.jar`.
- `PHYLO_LENS_PHYLOLIB_JAVA`: Java executable used with the PhyloLib JAR. The
  Docker image sets this to `/opt/java/openjdk/bin/java`.

When `PHYLO_LENS_PHYLOLIB_JAR` is unset or does not point to a readable file,
`typing_data` ingest fails with a PhyloLib runtime error. The production image
should use the bundled JAR path and should not mount the host Docker socket.

The service starts without a mounted volume, but data is then scoped to the
container filesystem. Use `-v phylo-lens-data:/data` for persistence across
container restarts.

## Browser Integration

Install the browser library separately:

```bash
npm install @phyloviz/phylo-lens
```

Then point it at the deployed API service:

```ts
createPhyloLensView({
  container,
  apiUrl: "http://localhost:8000",
});
```

## Tests

```bash
pytest -q
```
