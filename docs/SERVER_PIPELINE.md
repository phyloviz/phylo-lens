# Server preparation pipeline

`POST /api/graph/prepare` converts raw input into an immutable, queryable layout
version. Preparation is the only operation that requires the complete graph.
Viewport, region, and search requests operate on persisted artifacts.

```text
request validation
  → capacity admission
  → normalization
  → layout identity
  → distance-tier clustering
  → global layout
  → LoD edge materialization
  → persistence
  → publication
```

## 1. Request validation

FastAPI validates the `NormalizeRequest` contract before application logic runs.
The request contains:

- source format and content;
- dataset name;
- self-loop policy;
- optional typed metadata;
- optional ancillary CSV/TSV data.

Malformed HTTP payloads return `422`. Source-format and domain errors are mapped
to the API errors described in [API reference](./API_REFERENCE.md).

## 2. Job admission

### Local backend

The in-process `PrepareJobRegistry` enforces the configured active-job limit.
Capacity is reserved **before normalization**, so typing-data requests cannot
start expensive PhyloLib subprocesses outside the queue limit.

The reservation is released on every exit path. After normalization, the job is
submitted with `reserved_capacity=True`; the registry then tracks the worker
future.

The local registry may reuse an active or successful completed job with the same
`(dataset_id, layout_version)`. Failed jobs are not reused.

Completed jobs retain a small response payload, not the complete
`PreparedLayoutResult`, preventing prepared graphs from accumulating in memory.

### PostgreSQL backend

The API inserts a durable prepare job. External workers claim jobs through
PostgreSQL row locking and leases. The job payload and artifact store survive API
process restarts.

## 3. Normalization

`normalize_dataset` converts the selected source into a `CanonicalDataset`.

### Newick path

```text
Newick text
  → parse one tree or forest
  → canonical node identifiers
  → canonical edges and branch distances
  → metadata and ancillary join
  → domain validation
```

### Typing-data path

```text
allelic-profile matrix
  → PhyloLib Hamming distance
  → PhyloLib goeBURST
  → Newick tree or forest
  → normal Newick canonicalization path
```

Typing data and ancillary metadata are independent. PhyloLib constructs the
relationship graph; PhyloLens joins isolate or profile attributes afterwards.

### Distance completion

If the graph has edges and **none** carries a distance, the service assigns unit
distance to all edges and emits a warning. If any distance exists, missing values
are left visible to validation; preparation then rejects the partially weighted
graph.

### Metadata handling

Normalization:

- validates caller-supplied metadata types;
- infers undeclared field types;
- joins ancillary rows by exact or slug-normalized identifier;
- aggregates multiple rows per node;
- preserves direct metadata on field conflicts;
- hides internal aggregation keys from public schemas.

The normalization result also records ingest and normalization durations for
internal diagnostics. These values are not currently part of the public prepare
response.

## 4. Dataset validation

Domain validation checks structural invariants, including:

- non-empty identifiers;
- edge endpoints that exist in the node set;
- self-loop policy;
- metadata values compatible with the canonical schema;
- no use of reserved metadata fields.

Preparation adds two requirements:

- at least one node;
- a distance value on every edge.

## 5. Layout identity

`layout_version_for_dataset` computes a deterministic fingerprint from:

- `LAYOUT_PIPELINE_VERSION`;
- dataset identifier;
- sorted nodes and edges;
- distances;
- metadata schema and values;
- ancillary rows;
- stable source semantics.

The generated timestamp is excluded. Canonical JSON serialization makes the
fingerprint independent of dictionary insertion order.

This identity controls job reuse and artifact publication. A change to persisted
metadata or layout-affecting pipeline semantics creates a new version.

## 6. Distance-tier clustering

The pipeline selects up to 16 distance thresholds. Threshold selection targets a
progressive number of visible representatives instead of sampling edge distances
uniformly.

At each threshold, a union-find partition connects edges whose distance is less
than or equal to the threshold. The complete edge list is sorted once and reused
across thresholds.

For every component, the pipeline records:

- member nodes;
- one deterministic representative;
- internal edges;
- boundary edges.

The finest selected threshold is retained so the viewport reader can resolve the
last LoD level to individual node positions.

See [LoD and clustering](./LOD_AND_CLUSTERING.md) for the selection and query
semantics.

## 7. Artifact publication begins

The worker clears an incomplete artifact set with the same identity, then writes
the canonical dataset and cluster records with status `refining`.

A `refining` version is not selected as the latest readable version. An earlier
published layout therefore remains available while a new version is prepared.

## 8. Prepared quotient edges

For each non-finest threshold, the pipeline maps canonical edge endpoints to
cluster representatives.

Edges internal to one cluster disappear at that tier. Multiple canonical edges
between the same pair of representatives collapse into one deterministic
prepared edge. The retained distance is the smallest available distance for that
representative pair.

These quotient edges allow viewport reads to return a topologically consistent
coarse graph without rebuilding it on every request.

## 9. Global layout

The layout stage computes one global position for each canonical node.

### Source coordinates

When every node already has `x` and `y`, those positions are used as the global
layout input.

### Graphviz `sfdp`

Otherwise, PhyloLens invokes Graphviz `sfdp` with a generated undirected DOT
graph.

- Edge lengths use the ratio between each positive distance and the median
  positive distance, subject to bounded minimum and maximum lengths.
- Connected graphs use global overlap removal.
- Disconnected forests use component packing to avoid a pathological global
  overlap pass.
- `maxiter` is derived from node count.
- by default the subprocess has no wall-clock timeout; an operator can opt in
  to `PHYLO_LENS_GRAPHVIZ_SFDP_TIMEOUT_SECONDS`.

Graphviz output is parsed from the `plain` format, centered, and scaled to a
target median edge length. A one-axis output receives deterministic separation;
a complete point-collapsed `sfdp` result is retained as returned rather than
silently replaced with another layout algorithm.

### Layout failures

If `sfdp` is missing, exits unsuccessfully, times out when an explicit timeout
is configured, or returns incomplete positions, preparation fails and does not
publish a layout version. The failed job reports structured diagnostics,
including `algorithm`, `stage`, exit status, configured timeout, and stderr or
error detail where available. Circular layout is not an implicit fallback.

## 10. Cluster and node layouts

The global node coordinates are used to derive:

- one `NodeLayoutPosition` per canonical node;
- one `ClusterLayout` per prepared cluster.

A cluster layout uses the global position of its representative and stores
member-derived bounds and radius. The pipeline does not run a separate layout
for each semantic-zoom tier; all tiers remain in one global coordinate system.

## 11. Persistence

The worker persists:

1. canonical dataset and metadata;
2. prepared clusters and membership;
3. original graph edges;
4. node positions;
5. cluster layouts and aggregated metadata;
6. per-tier prepared edges.

SQLite and PostgreSQL implement the same repository contract. Bulk writes are
chunked and grouped under transaction boundaries.

## 12. Publication

After all artifacts are stored, the worker publishes the dataset row as `ready`.

Only then can reads that omit `layout_version` resolve the new version.

The worker returns a compact prepare result containing counts, LoD tier count,
layout status, and combined warnings. Both local and PostgreSQL job paths use the
same canonical payload builder.

## 13. Failure and cancellation behavior

A failed preparation records a terminal job error and does not publish the
layout. Relevant cases include:

- invalid Newick or typing data;
- PhyloLib process failure or timeout;
- missing edge distances in a partially weighted graph;
- Graphviz missing, non-zero, incomplete, or explicitly timed-out layout;
- database error;
- lost PostgreSQL lease before publication.

PostgreSQL workers use lease ownership checks between publication phases. A
worker that loses ownership aborts before publishing further artifacts.

## 14. Interactive read path

After publication, interactive requests do not repeat preparation. They resolve a
layout version and execute bounded repository reads:

```text
viewport query
  → LoD threshold
  → bounds lookup
  → visible nodes and required neighbours
  → matching original or prepared edges
  → metadata attachment
  → HTTP response
```

Region selection always reads finest-detail nodes within the requested box.
Search reads node identifiers and public metadata, ranks matches, and returns
global positions for navigation.

## Evaluation guidance

Preparation measurements should separate at least:

- source ingest and parsing;
- PhyloLib distance calculation;
- goeBURST;
- canonical normalization;
- cluster/LoD construction;
- Graphviz layout;
- persistence;
- initial viewport read and serialization.

A benchmark should use a clean process or explicitly control cache and persisted
layout reuse. Reusing an identical `(dataset_id, layout_version)` measures cache
behavior, not preparation throughput.
