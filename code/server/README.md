# PhyloLens Server

FastAPI service for deterministic phylogenetic normalization, threshold
clustering, `sfdp` layout precomputation, and bounded viewport reads. Local mode
uses a SQLite prepared-layout store; distributed production mode uses Postgres
for durable prepare jobs and prepared-layout artifacts. See the
[`docs/`](../../docs/README.md) set for the full architecture.

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
  -e PHYLO_LENS_CORS_ORIGINS=http://localhost:3000,http://localhost:5173 \
  -v phylo-lens-data:/data \
  ghcr.io/phyloviz/phylo-lens-service:0.1.0
```

The container listens on port `8000`, binds to `0.0.0.0`, and writes local-mode
prepared layout data under `/data`. The image includes Python 3.12, the server
package, FastAPI/uvicorn, SQLite from the Python standard library, Graphviz
`sfdp`, the PostgreSQL driver (`psycopg`), and the PhyloLib Java runtime from
the digest-pinned PhyloLib image.
Production
`typing_data` ingest runs `java -jar /app/phylolib.jar` inside this service
container; it does not need host Docker access.

The published service image supports `linux/amd64` and `linux/arm64`. See
[Release and CI](../../docs/RELEASE.md) for platform validation and publication
details.

The bundled PhyloLib JAR path is `/app/phylolib.jar`.

Typing-data ingest uses a temporary working directory and runs:

```bash
java -jar /app/phylolib.jar distance hamming \
  --dataset=ml:/tmp/phylolib-.../profiles.txt \
  --out=symmetric:/tmp/phylolib-.../matrix.txt

java -jar /app/phylolib.jar algorithm goeburst \
  --matrix=symmetric:/tmp/phylolib-.../matrix.txt \
  --out=newick:/tmp/phylolib-.../tree.nwk \
  --lvs=3
```

Health check:

```bash
curl http://localhost:8000/health
# {"status":"ok","service_version":"0.1.0","api_version":"1"}
```

The browser library reads this same endpoint on the first `load()` call and
verifies `api_version` before submitting a prepare job. `service_version`
identifies the service implementation build; `api_version` is the stable HTTP
contract version and is the only value used for compatibility.

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

Postgres distributed-storage smoke validation:

```bash
cd code/server
python -m pip install -e '.[postgres]'
./scripts/postgres-job-smoke.sh
```

## API

The runtime is driven by two endpoints under `/api/graph`. See
[`../../docs/ARCHITECTURE_SPEC.md`](../../docs/ARCHITECTURE_SPEC.md) and
[`../../docs/DATA_MODEL.md`](../../docs/DATA_MODEL.md) for full contracts.

### `GET /health`

Returns service health.

### `POST /api/graph/prepare`

Normalizes input (synchronously) and submits a background job that materializes
the LoD runtime artifacts into the configured prepared-layout store:

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
stable full-layout `global_bounds`, and `metadata_schema`. Set `cluster_id` to
expand a single cluster into its members.

## Storage

Local deployments persist prepared layouts through `PreparedLayoutStore`, a
SQLite database keyed by `(dataset_id, layout_version)`. Distributed deployments
use Postgres for both durable job state and prepared-layout artifacts, so API
replicas and external workers read and write the same database without a shared
filesystem. See the schema in [`../../docs/DATA_MODEL.md`](../../docs/DATA_MODEL.md).

Install the Postgres extra for production/distributed mode:

```bash
pip install "phylo-lens-server[postgres]"
```

The Postgres schema lives in `sql/postgres/create-schema.sql` and is packaged
with the server distribution. The applied schema checksum is recorded in
`phylo_lens_schema_version`.

Create the schema explicitly before starting API replicas or workers:

```bash
PHYLO_LENS_POSTGRES_DSN=postgresql://... phylo-lens-init-postgres
```

API replicas and workers verify that the schema is current at startup;
they do not create or mutate the Postgres schema as a side effect of serving
traffic.

Run API replicas against the durable job backend:

```bash
PHYLO_LENS_PREPARE_JOB_BACKEND=postgres \
PHYLO_LENS_POSTGRES_DSN=postgresql://... \
phylo-lens-server
```

Run one or more external prepare workers:

```bash
PHYLO_LENS_POSTGRES_DSN=postgresql://... \
phylo-lens-prepare-worker
```

When `PHYLO_LENS_PREPARE_JOB_BACKEND=postgres`, the API uses
`PostgresPrepareJobStore` for queue/lease state and
`PostgresPreparedLayoutStore` for materialized layouts. `PHYLO_LENS_DATA_DIR`
and `PHYLO_LENS_PREPARED_LAYOUT_STORE_DIR` apply only to local SQLite mode.

Environment variable:

- `PHYLO_LENS_DATA_DIR`: local-mode data root. When set, SQLite prepared layouts
  are stored below `${PHYLO_LENS_DATA_DIR}/prepared_layout`. The Docker image
  sets this to `/data`.
- `PHYLO_LENS_PREPARED_LAYOUT_STORE_DIR`: local-mode SQLite store directory.
  Defaults to
  a `phylo_lens_prepared_layout` directory under the system temp dir when
  `PHYLO_LENS_DATA_DIR` is unset. If both variables are set, this explicit store
  directory wins.
- `PHYLO_LENS_MAX_ACTIVE_PREPARE_JOBS`: optional positive integer cap for new
  queued/running prepare jobs in this server process. Duplicate submissions for
  the same `(dataset_id, layout_version)` reuse the existing job and do not
  consume extra capacity. Local mode reserves capacity before normalization, so
  `typing_data` PhyloLib work cannot bypass this cap. When the cap is reached,
  new distinct prepare requests return `429`.
- `PHYLO_LENS_PREPARE_JOB_BACKEND`: `local` (default) uses the in-process
  background worker; `postgres` submits/polls durable jobs in Postgres and
  expects separate `phylo-lens-prepare-worker` processes to execute them.
- `PHYLO_LENS_POSTGRES_DSN`: Postgres connection string required by
  `PHYLO_LENS_PREPARE_JOB_BACKEND=postgres`, `phylo-lens-init-postgres`, and
  `phylo-lens-prepare-worker`.
- `PHYLO_LENS_WORKER_ID`: optional stable worker id for
  `phylo-lens-prepare-worker`. Defaults to a generated host-qualified id.
- `PHYLO_LENS_WORKER_LEASE_SECONDS`: worker lease duration. The worker renews
  the lease while layout computation is running and fences artifact publication
  on current ownership.
- `PHYLO_LENS_WORKER_POLL_INTERVAL_SECONDS`: delay between empty worker polls.
- `PHYLO_LENS_WORKER_MAX_JOBS`: optional positive integer for one-shot worker
  runs, mostly useful for tests, batch jobs, and controlled process recycling.
- `PHYLO_LENS_CORS_ORIGINS`: comma-separated browser origins allowed to call the
  service directly, for example
  `http://localhost:5173,https://phyloviz.example.org`. Values are trimmed and
  empty entries are ignored. The default is empty, so production deployments do
  not permit cross-origin browser access unless explicitly configured. The
  service does not enable browser credentials/cookies.
- `PHYLO_LENS_PHYLOLIB_JAR`: path to the bundled PhyloLib JAR for
  `typing_data` ingest. The Docker image sets this to `/app/phylolib.jar`.
- `PHYLO_LENS_PHYLOLIB_JAVA`: Java executable used with the PhyloLib JAR. The
  Docker image sets this to `/opt/java/openjdk/bin/java`.
- `PHYLO_LENS_PHYLOLIB_TIMEOUT_SECONDS`: positive numeric timeout, in seconds,
  for each PhyloLib Java subprocess. Default: `300`.
- `PHYLO_LENS_GRAPHVIZ_SFDP_TIMEOUT_SECONDS`: positive numeric timeout, in
  seconds, for each Graphviz `sfdp` layout subprocess. Default: `300`.

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

### Deployment Modes

Direct API access:

```ts
createPhyloLensView({
  container,
  apiUrl: "https://api.example.org",
});
```

For this mode, configure the service with the host application's browser origin:

```bash
PHYLO_LENS_CORS_ORIGINS=https://app.example.org
```

Same-origin reverse proxy, recommended for many production deployments:

```ts
createPhyloLensView({
  container,
  apiUrl: "/phylo-lens/api",
});
```

The host web server proxies that path to the service container. This avoids
cross-origin configuration and browser mixed-content issues. Minimal Nginx
example:

```nginx
location /phylo-lens/api/ {
  proxy_pass http://phylo-lens-service:8000/;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
}
```

Docker-internal names such as `http://phylo-lens-service:8000` are reachable by
other containers, not by browser JavaScript, unless exposed through a published
port or a reverse proxy.

## Tests

```bash
pytest -q
```
