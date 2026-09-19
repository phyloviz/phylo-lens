# PhyloLens API service

The PhyloLens API service performs the operations that are deliberately kept out
of the browser:

- Newick and typing-data normalization;
- PhyloLib distance and goeBURST processing;
- Graphviz `sfdp` layout computation;
- distance-threshold clustering and LoD materialization;
- persistent storage of prepared layouts;
- bounded viewport, region and search queries.

The service is deployed independently from `@phyloviz/phylo-lens`. The browser
library receives the service base URL through `apiUrl` and validates the API
contract before the first preparation request.

## Requirements

Local source execution requires:

- Python 3.12 or later;
- Graphviz with the `sfdp` executable for force-directed layouts;
- Java and a configured PhyloLib JAR for `typing_data` input;
- PostgreSQL only for the distributed job and artifact backends.

The published Docker image includes Python, Graphviz, Java, the PhyloLib JAR,
and the PostgreSQL driver.

Newick forests may contain isolated nodes. Graphviz's spring smoother assumes
every node has a non-self neighbour and can abort on singleton components.
PhyloLens sends only edge-bearing components to SFDP with the requested settings,
then places isolated nodes in a deterministic grid beside the resulting bounds.
All nodes and edges are retained; no artificial links are added. An entirely
edgeless forest uses the grid directly. Layout pipeline v2 invalidates older
cached layouts to ensure this handling takes effect.

## Install and run from source

```bash
cd code/server
python -m pip install -e '.[test,dev]'
export PHYLO_LENS_PHYLOLIB_JAR=/absolute/path/to/PhyloLib-1.0.0.jar
uvicorn phylo_lens_server.main:app --reload
```

`typing_data` requests require `PHYLO_LENS_PHYLOLIB_JAR` during source
execution. The Docker image supplies `/app/phylolib.jar` automatically.

The console entry point is equivalent:

```bash
phylo-lens-server
```

Source execution binds to `127.0.0.1:8000` by default. The Docker image binds to
`0.0.0.0:8000`.

Verify the service:

```bash
curl http://localhost:8000/health
```

```json
{
  "status": "ok",
  "service_version": "0.2.1",
  "api_version": "1"
}
```

`service_version` identifies the implementation release. `api_version` is the
independent compatibility contract used by the browser package.

## Docker

Build locally:

```bash
cd code/server
docker build -t phylo-lens-service:local .
```

Run with persistent local storage:

```bash
docker run --rm \
  -p 8000:8000 \
  -e PHYLO_LENS_CORS_ORIGINS=http://localhost:5173 \
  -v phylo-lens-data:/data \
  phylo-lens-service:local
```

Published image:

```text
ghcr.io/phyloviz/phylo-lens-service:<version>
```

Verified platforms:

- `linux/amd64`;
- `linux/arm64`.

The Dockerfile pins the PhyloLib source image by multi-platform manifest digest.
`phylolib.jar.sha256` is the executable source of truth for the expected bundled
JAR checksum. CI builds and smoke-tests each architecture independently before a
release publishes a combined manifest.

The image builds the pinned upstream Graphviz 12.2.1 and GTS source releases;
Alpine does not package GTS. `graphviz-capability-smoke` runs during image build
and container CI, exercising PhyloLens' connected-graph `overlap=scale` path;
it reports the Graphviz and GTS runtime versions and rejects missing
triangulation support.

### Compose

```bash
cd code/server
docker compose up --build
```

### Container validation

```bash
./scripts/container-smoke.sh
```

The smoke test verifies:

- `/health`;
- Newick prepare and viewport reads;
- typing-data prepare through PhyloLib;
- Graphviz `sfdp`;
- Java;
- the bundled JAR checksum;
- PhyloLib CLI startup;
- `psycopg` import.

## API overview

| Method | Path                          | Purpose                                                        |
| ------ | ----------------------------- | -------------------------------------------------------------- |
| `GET`  | `/health`                     | Liveness and service/API version information                   |
| `POST` | `/api/graph/prepare`          | Normalize input and submit asynchronous layout preparation     |
| `GET`  | `/api/graph/prepare/{job_id}` | Poll a preparation job                                         |
| `POST` | `/api/graph/viewport`         | Read a bounded graph slice at a requested LoD tier             |
| `POST` | `/api/graph/region`           | Read a finest-detail rectangular subgraph and metadata summary |
| `POST` | `/api/graph/search`           | Search node identifiers and metadata across a prepared layout  |

See the [HTTP API reference](../../docs/API_REFERENCE.md) for request and
response models, defaults, validation and examples.

## Input processing

### Newick

Newick input may contain one tree or a `;`-separated forest. Branch lengths are
used as edge distances for clustering and layout. Quoted labels, comments and
labeled internal nodes are accepted.

A fully unweighted graph, where every edge distance is absent, is assigned unit
edge distances before preparation. A partially weighted graph is rejected by
the preparation pipeline because every edge must carry a distance.

### Typing data

`typing_data` input is passed to the bundled PhyloLib JAR in two stages:

```bash
java -jar /app/phylolib.jar distance hamming \
  --dataset=ml:<profiles> \
  --out=symmetric:<matrix>

java -jar /app/phylolib.jar algorithm goeburstfullmst \
  --matrix=symmetric:<matrix> \
  --out=newick:<tree>
```

Full MST uses all observed locus-variant levels and produces one spanning tree
for valid typing profiles.

Each PhyloLib subprocess is limited by
`PHYLO_LENS_PHYLOLIB_TIMEOUT_SECONDS`. Graphviz `sfdp` has no default
wall-clock limit; `PHYLO_LENS_GRAPHVIZ_SFDP_TIMEOUT_SECONDS` is an opt-in
operational limit.

See [Input formats](../../docs/INPUT_FORMATS.md) for the full contract.

## Storage and job execution

PhyloLens supports two deployment modes.

### Local mode

Local mode is the default:

- preparation runs in an in-process worker;
- job state is held by the local registry;
- prepared artifacts are stored in SQLite;
- the Docker image stores SQLite data below `/data/prepared_layout`.

This mode is suitable for development, evaluation, and single-service
deployments.

```bash
PHYLO_LENS_PREPARE_JOB_BACKEND=local phylo-lens-server
```

### PostgreSQL mode

Distributed mode uses PostgreSQL for both durable prepare jobs and prepared
layout artifacts. API replicas submit and poll jobs; one or more external worker
processes claim jobs with leases and publish artifacts to the same database.

Install the optional dependency when running from source:

```bash
python -m pip install -e '.[postgres]'
```

Initialize the schema explicitly:

```bash
PHYLO_LENS_POSTGRES_DSN=postgresql://user:password@host/database \
  phylo-lens-init-postgres
```

Run API replicas:

```bash
PHYLO_LENS_PREPARE_JOB_BACKEND=postgres \
PHYLO_LENS_POSTGRES_DSN=postgresql://user:password@host/database \
  phylo-lens-server
```

Run workers:

```bash
PHYLO_LENS_POSTGRES_DSN=postgresql://user:password@host/database \
  phylo-lens-prepare-worker
```

API replicas and workers verify the stored schema checksum at startup. They do
not apply DDL while serving traffic.

## Configuration

### Service and storage

| Variable                               | Default                    | Description                                                                                              |
| -------------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------------------- |
| `PHYLO_LENS_DATA_DIR`                  | unset                      | Local-mode data root. The Docker image sets `/data`.                                                     |
| `PHYLO_LENS_PREPARED_LAYOUT_STORE_DIR` | system temporary directory | Explicit local SQLite store directory. Overrides `PHYLO_LENS_DATA_DIR`.                                  |
| `PHYLO_LENS_MAX_ACTIVE_PREPARE_JOBS`   | unlimited                  | Positive integer limit for distinct active local jobs. Duplicate layout submissions reuse existing work. |
| `PHYLO_LENS_PREPARE_JOB_BACKEND`       | `local`                    | `local` or `postgres`.                                                                                   |
| `PHYLO_LENS_POSTGRES_DSN`              | unset                      | Required for PostgreSQL mode, schema initialization and external workers.                                |
| `PHYLO_LENS_CORS_ORIGINS`              | empty                      | Comma-separated browser origins allowed to call the service directly.                                    |

CORS permits `GET`, `POST`, and `PUT` with the `Content-Type` header. Credentials and
cookies are disabled. An empty origin list is the safe production default.

### External processes

| Variable                                   | Default                   | Description                                                                     |
| ------------------------------------------ | ------------------------- | ------------------------------------------------------------------------------- |
| `PHYLO_LENS_PHYLOLIB_JAR`                  | unset in source execution | Readable PhyloLib JAR path. The image sets `/app/phylolib.jar`.                 |
| `PHYLO_LENS_PHYLOLIB_JAVA`                 | `java`                    | Java executable. The image sets `/opt/java/openjdk/bin/java`.                   |
| `PHYLO_LENS_PHYLOLIB_TIMEOUT_SECONDS`      | `300`                     | Positive timeout for each PhyloLib subprocess.                                  |
| `PHYLO_LENS_GRAPHVIZ_SFDP_TIMEOUT_SECONDS` | unset (unlimited)         | Optional positive wall-clock timeout for the Graphviz `sfdp` layout subprocess. |

PhyloLens requests Graphviz `sfdp` for every non-trivial global layout and waits
for it to complete by default; this work may be expensive. Missing, non-zero,
timed-out, or incomplete `sfdp` executions fail preparation and return
structured job diagnostics (`algorithm`, `stage`, exit status, configured
timeout, and stderr/detail where available). Circular layout is not an implicit
fallback.

### PostgreSQL worker

| Variable                                  | Default                     | Description                                                                                     |
| ----------------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------- |
| `PHYLO_LENS_WORKER_ID`                    | generated host-qualified ID | Stable worker identifier.                                                                       |
| `PHYLO_LENS_WORKER_LEASE_SECONDS`         | `300`                       | Job lease duration. Heartbeats run at approximately one third of this value.                    |
| `PHYLO_LENS_WORKER_POLL_INTERVAL_SECONDS` | `2`                         | Delay between empty queue polls.                                                                |
| `PHYLO_LENS_WORKER_MAX_JOBS`              | unlimited                   | Optional positive job count before the worker exits. Useful for controlled recycling and tests. |

## Browser integration

Install the browser package separately:

```bash
npm install @phyloviz/phylo-lens
```

### Direct service access

```ts
createPhyloLensView({
  container,
  apiUrl: "https://api.example.org",
});
```

Allow the host application's browser origin:

```bash
PHYLO_LENS_CORS_ORIGINS=https://app.example.org
```

### Same-origin reverse proxy

A same-origin proxy avoids CORS configuration and mixed-content failures:

```ts
createPhyloLensView({
  container,
  apiUrl: "/phylo-lens",
});
```

Minimal Nginx example:

```nginx
location /phylo-lens/ {
  proxy_pass http://phylo-lens-service:8000/;
  proxy_http_version 1.1;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
}
```

The browser then calls:

```text
/phylo-lens/health
/phylo-lens/api/graph/prepare
/phylo-lens/api/graph/viewport
```

Docker-internal service names are reachable by other containers, not directly
by browser JavaScript.

## Development validation

```bash
cd code/server
python -m pip install -e '.[test,dev]'
ruff check src tests
ruff format --check src tests
pytest -q
```

PostgreSQL smoke test:

```bash
python -m pip install -e '.[postgres]'
./scripts/postgres-job-smoke.sh
```

For internals, see:

- [Architecture](../../docs/ARCHITECTURE_SPEC.md)
- [Server preparation pipeline](../../docs/SERVER_PIPELINE.md)
- [Data model and persistence](../../docs/DATA_MODEL.md)
- [CI and release process](../../docs/RELEASE.md)

## Ancillary domain model and compatibility

Canonical datasets now separate user observations (`ancillary_schema` and
`annotations_by_node_id[*].ancillary_data`) from calculated category frequencies
(`ancillary_summary.category_counts`) and represented isolate counts
(`profile_summary.isolate_count`). `Isolate.ancillary_data` contains the original
isolate observations. Topology, layout state and provenance remain separate.

Normalization requests accept `ancillary_schema` / `ancillary_by_node_id` and
the API v1 `metadata_schema` / `metadata_by_node_id` aliases. Sending both names
for one option is rejected. API v1 responses and existing SQL column/table names
are unchanged; compatibility adapters preserve the legacy numeric encoding used
in layout fingerprints. This refactor does not require a database migration.

Old Python domain imports (`MetadataField`, `MetadataType`, `IsolateRecord`) remain
aliases. Canonical `metadata_by_node_id` is a deprecated, derived snapshot:
mutate `annotations_by_node_id` instead. Native canonical serialization uses the
new domain names; old canonical payloads remain accepted. See
[the migration notes](../../docs/ancillary-domain.md).

Scalar values produced by grouping (for example, a concatenated set of countries)
are stored in `AncillarySummary.values`, alongside category frequencies. Original
per-isolate values remain in `Isolate` ancillary data. Flat legacy records with
computed counts are decoded as node summaries; legacy records without counts
remain direct ancillary values.
