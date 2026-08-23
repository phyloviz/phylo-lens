# Known limitations and future work

This document records current limitations that are relevant to users,
deployment, or thesis evaluation. It is not a history of resolved implementation
tasks.

Items are grouped by impact. They are not commitments to a specific release.

## Evaluation-critical work

### Reproducible experimental harness

The core runtime is feature-frozen, but the thesis evaluation harness remains to
be implemented under `eval/`.

It should record:

- dataset identity and source;
- commit and release version;
- hardware and operating system;
- browser and runtime versions;
- repetitions, warm-up, timeout, and cache policy;
- stage timings, memory, response sizes, and rendered-element counts;
- raw results in a machine-readable format;
- scripts that generate tables and figures.

The evaluation should distinguish full preparation from prepared-layout reuse.

### Stage-level timing

The server currently exposes selected internal timing through logs and
normalization statistics, but it does not yet produce one complete structured
record for every preparation stage. The evaluation harness should capture, with
minimal measurement overhead:

- parsing/input ingest;
- PhyloLib distance calculation;
- goeBURST;
- canonical normalization;
- cluster/LoD construction;
- Graphviz layout;
- persistence;
- initial viewport read and serialization;
- client snapshot conversion and application;
- first browser paint.

### Layout-parameter study

`Graphviz sfdp` iteration count and edge-length scaling are deterministic
heuristics. Their cost and layout quality should be evaluated rather than
presented as optimal. Any change to the pipeline policy requires a new
`LAYOUT_PIPELINE_VERSION`.

## Runtime limitations

### PostgreSQL admission occurs after normalization

The local backend reserves active-job capacity before Newick normalization or
PhyloLib execution. The PostgreSQL job backend enforces its durable queue limit
when the normalized canonical dataset is submitted.

Consequently, concurrent typing-data requests to an API replica may perform
PhyloLib work before PostgreSQL admission rejects excess jobs. A complete
distributed solution would enqueue the raw request or reserve durable capacity
before normalization.

This does not affect correctness, but it can affect resource isolation under
concurrent distributed load.

### Superseded browser work is ignored, not fully cancelled

The browser uses load generations and viewport request sequences so stale
responses cannot commit renderer state. It does not currently propagate an
`AbortSignal` through every fetch, poll delay, and server job.

A superseded load may therefore continue consuming transport or server resources
until it completes. Adding cooperative cancellation would reduce wasted work but
requires an explicit job-cancellation contract for server-side preparation.

### Completed local job metadata has no eviction policy

The local registry removes completed futures and full prepared results, but keeps
small terminal snapshots and successful layout-key mappings for process-lifetime
reuse. Very long-lived services receiving many distinct datasets may eventually
benefit from TTL or LRU eviction.

The current behavior is suitable for evaluation and bounded single-service
usage; it should be monitored before indefinite multi-tenant deployment.

### Partially weighted graphs are rejected

If all edges lack distance, PhyloLens assigns unit distance. If only some edges
lack distance, preparation fails.

A future input policy could support an explicit missing-distance strategy, but it
must not silently mix biological branch lengths with arbitrary fallback values.

### Graphviz degradation is limited

A missing, failed, incomplete, or explicitly timed-out `sfdp` execution fails
preparation. There is no implicit secondary layout engine.

### Typing-data algorithm parameters are fixed

The current public contract uses:

- Hamming distance;
- goeBURST;
- `lvs = 3`.

The API does not expose alternative PhyloLib distance methods or goeBURST
parameters. Exposing them would change the reproducibility and fingerprint
contract and should be designed explicitly.

## Client limitations

### Reserved load fields are currently inactive

The public TypeScript load type retains:

- `layout.forceIterations`;
- `lod.lodHint`;
- `lod.viewport`.

The production load path does not use them. They should either receive defined
semantics in a future compatible release or be removed in the next intentional
public-API breaking release.

### Cluster expansion is not persistent

Expanded members are a client-side patch. A subsequent ordinary viewport
snapshot may replace the expansion. The server does not receive a set of expanded
cluster identifiers with each viewport query.

### No public programmatic expand/collapse API

Cluster interaction is currently driven through renderer events and internal
workbench methods. The package-root `PhyloLensView` exposes only `load()` and
`dispose()`.

A future host-control API may expose search, focus, expansion, filter, and mapping
operations without exporting workbench or renderer internals.

### `load()` is not a first-paint metric

`load()` resolves after the first graph snapshot is applied to the renderer. It
does not await the next browser animation frame or camera-fit animation. The
evaluation must measure first paint separately.

### Local filters operate on the visible snapshot

Metadata filters do not execute against all persisted nodes. At coarse LoD, they
operate on representative metadata; at fine LoD, they operate on visible node
metadata. Server-side filtered graph queries would require a separate contract
and index strategy.

### Search is intentionally simple

Search uses deterministic identifier and metadata matching with fixed scoring.
It does not provide fuzzy matching, tokenization, stemming, or domain-specific
ontology search.

## Deployment and security limitations

### No authentication or authorization

The service has no user, tenant, or dataset-access model. Deployments that expose
sensitive metadata must place PhyloLens behind an authenticated host application
or gateway.

### No TLS termination

The FastAPI container serves HTTP. Production TLS should terminate at a reverse
proxy, ingress, or platform load balancer.

### No automatic retention management

Prepared SQLite/PostgreSQL layout versions persist until removed by the operator.
There is no built-in dataset deletion, retention period, quota, or garbage
collection endpoint.

### PostgreSQL schema migration is initialization-oriented

The repository verifies an expected schema checksum and provides explicit schema
initialization. It does not yet provide a multi-version migration framework.

## Documentation and project governance

Before broad external contribution, the repository should confirm:

- an explicit open-source license file approved by the project owners;
- contribution and code-of-conduct policy when external contributors are
  expected;
- release ownership and npm/GHCR recovery procedures shared beyond one person;
- archival or mirroring policy for the INESC-ID GitLab repository.

## Out of scope for the current thesis implementation

The following are intentionally not part of the current core:

- browser-side global layout;
- Kubernetes manifests;
- real-time collaborative state;
- write/edit operations on phylogenetic data;
- evolutionary inference from sequence alignments;
- generic graph-database querying;
- automatic biological interpretation of clusters;
- a replacement for PhyloLib, Graphviz, or a dedicated phylogenetic inference
  pipeline.
