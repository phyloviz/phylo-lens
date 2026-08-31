# RQ1–RQ4 evaluation methodology

## Final released-OCI RQ1 protocol

The definitive RQ1 campaign is distinct from the legacy direct-import runner
documented below.  It is executed only by `phylo_lens_eval.rq1_final` using
the released PhyloLens `v0.2.0` OCI service, pinned by index digest.  It uses
the retained pilot Newick inputs, rather than generating inputs during the
campaign: 5,000, 10,000, 25,000, 50,000, and 100,000 requested leaves, each
with balanced, irregular (seed 2026), and caterpillar topology.  Requested
leaves, actual parsed-node counts, topology, seed, byte size, and SHA-256 are
all fixed in `config/rq1-final-oci-v020.json` and verified before execution.

## Final RQ3: persisted hierarchical LoD fidelity and reduction

Final RQ3 asks: **How effectively does PhyloLens’s persisted hierarchical
level-of-detail representation reduce the materialized graph across persisted
LoD levels while preserving exact source-node membership, representative
positions, and quotient connectivity?** It is a deterministic correctness and
representation-reduction study, not a performance or browser benchmark.

The evaluator independently parses the retained canonical Newick input and
requires all 13,075 source IDs and 13,074 source edges. It prepares one frozen
v0.2.0 SQLite layout, uses one exact padded full-world rectangle for all three
persisted LoD levels, and never derives the expected source universe from a
LoD response. For each level it checks exact membership partitioning,
float-identity representative positions, full-detail source nodes/positions/
edges, and the source-derived quotient edge set (including supporting source
edge provenance). A semantic mismatch is retained as invalid evidence and
makes the final raw-only audit fail. Reduction counts distinguish represented
source nodes, materialized visual nodes, materialized edges, and triangle
proxies; the three levels are ordered cases, not statistical repetitions.

The retained RQ3 SQLite master is sealed only after a disposable product-build
process exits, an evaluation-only connection checkpoints and finalizes WAL
state, and the final retained copy is hashed. The audit recomputes its physical
SHA-256 and semantic table hashes through immutable read-only access. Final
`thesis-final-rq3-v020-001` is superseded for publication because its retained
SQLite artifact changed after finalization and its original audit trusted stored
metadata; `thesis-final-rq3-v020-002` is the authoritative replacement. This
is an evidence-integrity correction, not a scientific-protocol change.

Every condition has one retained warm-up and five measured observations.  A
fresh pinned service container and empty persistence directory are created for
each observation.  Health and a pre-timing `sfdp`/GTS smoke are required;
timing starts immediately before the public `POST /api/graph/prepare` request
and ends when the fixed-100-ms public-status polling loop first observes
`ready`.  The primary metric is `preparation_wall_ms = t_ready_observed - t0`.
The startup bound is 30 seconds, the preparation deadline is 300 seconds from
`t0`, and the outer watchdog is 345 seconds from service start.  These are
experiment bounds: the product's SFDP timeout remains unset.

Only `ready` layouts are successful.  Explicit preparation/layout failures,
timeouts, non-ready/degraded layouts, and infrastructure failures are retained
as raw observations without retry; all 90 matrix cells remain in the audit.
The runner records public requests, every status poll, terminal status,
service logs, persistence artifacts, runtime OCI platform identity/image
labels, and environment provenance.

Final memory evidence is a separate non-networked sidecar that shares the
service PID namespace.  It begins before `t0`, samples the recursive service
process tree every 20 ms, excludes itself and its descendants, and retains raw
member-PID RSS samples.  Root-only RSS is explicitly unavailable, not
equivalent evidence.  A successful final observation requires process-tree
scope and observed `sfdp` descendant evidence; otherwise it is audit-invalid.

RQ1 asks how server-side preparation cost changes with input size and topology,
and how cost is distributed across preparation stages. The direct-tree path is
measured as:

```text
Newick input → parsing → normalization → base layout → LoD construction
→ index construction → SQLite persistence/publication
```

The typing-profile path remains separate: profile parsing → distance
calculation → goeBURST → canonical normalization → base layout → LoD → index →
persistence. It is not executed in this phase because the repository does not
contain a suitable profile benchmark dataset. A goeBURST structure is not
described as a phylogenetic inference here.

## Measurement protocol

Each preparation is run in a fresh child process, with a newly created SQLite
persistence directory. The child invokes `normalize_dataset` and
`PreparedLayoutWorker`; it does not duplicate production algorithms. The parent
samples the child process tree with `psutil` every 0.02 seconds, applies the
configured wall-clock timeout to the complete process group, and writes
stdout/stderr per repetition. Child process isolation prevents retained Python
objects, in-process caches, and failed preparations from influencing later
repetitions. The sampling interval is stored as
`peak_rss_sampling_interval_seconds` in the manifest parameters.

Timing begins immediately before normalization and ends after the layout version
is published to SQLite. `wall_time_seconds` is authoritative for end-to-end
preparation. `stage_durations_seconds` records parsing, normalization, LoD
construction, quotient-edge index construction, base layout, and individual
persistence stages. Stage durations are not added together to estimate wall
time: they are retained separately because timing boundaries may nest or change
in future implementations.

Current machine-readable stage identifiers are `parsing`, `normalization`,
`lod_construction`, `index_construction`, `base_layout`, `persistence.clear`,
`persistence.publish`, `persist_artifacts.datasets`,
`persist_artifacts.prepared_clusters`, `persist_artifacts.cluster_members`,
`persist_artifacts.graph_edges`, `persist_artifacts.metadata_schema`,
`persist_artifacts.render_metadata`, `persist_artifacts.metadata_json`,
`persist_artifacts.node_metadata`, `persist_artifacts.cluster_metadata`,
`persist_layouts.prepared_clusters`,
`persist_layouts.node_positions.clear_existing`,
`persist_layouts.node_positions.rows`,
`persist_prepared_edges.clear_existing`, and `persist_prepared_edges.rows`.
`parsing` and `normalization` use the production normalizer's millisecond
diagnostics; their recorded precision is therefore limited by that diagnostic.

## Metrics

| Field                                        | Definition                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `wall_time_seconds`                          | Child monotonic elapsed time from direct-input normalization through artifact publication.                                                                                                                                                                                                                                                                    |
| `stage_durations_seconds`                    | Duration of each named internal pipeline boundary in seconds.                                                                                                                                                                                                                                                                                                 |
| `peak_rss_bytes`                             | Maximum sampled sum of RSS for the live child and recursively discovered live descendants. `peak_rss_scope` records a root-process fallback when process enumeration is unavailable. This is not an exact physical-memory high-water mark; short-lived peaks can occur between samples.                                                                       |
| `input_bytes`                                | Byte size of the source input file.                                                                                                                                                                                                                                                                                                                           |
| `persisted_artifact_bytes`                   | Sum of `prepared_layout.sqlite3` and its `-wal` and `-shm` sidecars when present. Manifests, requests, logs, raw observations, summaries, and resolved configuration are outside the persistence directory and excluded. SQLite connections are closed after each repository operation; any remaining WAL/SHM files are counted rather than silently omitted. |
| `declared_node_count`, `declared_edge_count` | Dataset-catalog counts, if declared by the dataset metadata.                                                                                                                                                                                                                                                                                                  |
| `observed_node_count`, `edge_count`          | Counts in the normalized canonical dataset. A disagreement with declared counts preserves both values and emits a warning; it does not silently rewrite the catalog.                                                                                                                                                                                          |
| `lod_tier_count`, `cluster_count`            | Distinct selected thresholds and materialized clusters in the produced artifacts.                                                                                                                                                                                                                                                                             |
| `layout_status`                              | `ready` for Graphviz output or `degraded` when the service’s documented fallback is used.                                                                                                                                                                                                                                                                     |

Observations retain warm-ups and failures. A timeout is `timeout`; a SIGKILL not
initiated by the harness is classified as probable `oom`; other non-successful
children are `runtime_error`. Failed observations never contribute a fabricated
numeric value.

Summaries are regenerated from raw JSONL. They exclude warm-ups, retain count,
successful count, and failed count, and report median, P25, P75, IQR, minimum,
and maximum for successful measured samples. P95 is intentionally not reported
by default.

No generated dataset is selected in this phase. If a generated dataset is added
later, generation must finish before this timing boundary and its topology,
algorithm, seed, and checksum must be added to the dataset metadata and
manifest before preparation starts.

Environment probes for Java, Graphviz, Docker, and Git each have a ten-second
timeout. Missing or inaccessible tools are represented as `null`; Git records
`available: false` when its commit cannot be read. These probes run before any
result file is written.

## RQ2: client-side visualization scalability

### Historical pilot

RQ2 measures a private evaluation page importing the built public
`@phyloviz/phylo-lens` entry. It does not expose Sigma, Graphology, workbench,
or renderer internals, and production TypeScript APIs are unchanged. Synthetic
fixtures record nodes, edges, aggregate triangles, total graphical primitives,
seed, checksum, bounds, labels, metadata configuration, and API contract
version. Labels remain a renderer setting, never a node count.

The first-render metric starts at `t0` immediately before `view.load()`, records
`t1` immediately after it resolves, and records `t2` on the second subsequent
`requestAnimationFrame`. The thesis-facing value is
`load_to_post_update_frame_ms = t2 - t0`; `t1 - t0` and `t2 - t1` are retained.
This is a rendering opportunity, not physical monitor scanout. Canvas checks
and screenshots occur after `t2` and are excluded from that timing.

After bootstrap and before view creation, and again after first render plus the
configured quiescence, the browser child asks CDP `Runtime.getHeapUsage` and
records its `usedSize` as `js_heap_used_bytes` and `totalSize` as
`js_heap_total_bytes`. Missing fields, CDP errors, embedder heap, and backing
storage are explicitly `unavailable`, never zero. These are JavaScript-isolate
heap measurements, not total browser memory; no garbage collection is forced.

RSS uses an atomic structured handoff, not a comparison of browser and Python
clocks. Node publishes `baseline`, waits for Python to sample and acknowledge
the live Chromium process tree, then publishes `load_render` immediately before
`view.load()`. `maximum_rss_bytes` is the maximum of only samples in that
phase. After `t2`, quiescence, and the post-render heap snapshot, Node publishes
`post_render` and waits for its acknowledged sample; it then publishes
`frame_experiment` before input, screenshot, disposal, and cleanup. Thus
`baseline_rss_bytes` excludes view creation/load/render,
`post_render_rss_bytes` is after quiescence, and screenshot/frame/cleanup RSS
cannot enter the initial-render peak. Python verifies the root PID is Chromium
and sums only its live non-zombie descendants. `root_only` is an explicit
fallback and remains usable for latency but never supplies process-tree RSS
summary metrics. A missing required sample is `process_monitor_failure`, not a
zero-byte value.

Frame stability starts immediately before the fixed input and ends immediately
after its final wheel event; it does not include deliberate idle time before or
after movement. The stored input record contains the canvas-centre coordinates,
drag deltas, step count, per-step and wheel waits, wheel deltas, viewport, and
device scale factor. This is a fixed input sequence, not a claim of identical
physical camera trajectories across machines. A repetition with fewer than its
configured minimum frame samples is invalid as `insufficient_frame_samples`.
Any replay graph/viewport response after the initial viewport invalidates the observation as
`unexpected_viewport_request`; external network requests are aborted and marked
invalid. Per-repetition median, quartiles, IQR, P95, maximum, and threshold
counts/proportions are computed from that repetition's raw frames. Cross-run
summaries use those per-repetition values and never pool frames.

Every warm-up, successful, invalid, timeout, and failed repetition remains in
raw JSONL. Summaries exclude warm-ups and report configured/success/invalid/
failure/timeout counts plus median, P25, P75, IQR, minimum, and maximum. Final
thesis runs should use headed Chromium on a recorded environment; CI uses only
a tiny headless fixture and is not evidence of scalability or display quality.

### Final v0.2.0 isolated client microbenchmark

The final RQ2 asks: **How does the PhyloLens browser client behave as the
materialized visual working set grows, in terms of first-visualization latency,
JavaScript heap usage, and frame pacing?** It is deliberately a loopback-replay
microbenchmark, not a real-server viewport/LoD experiment. Replay removes
preparation, database, layout, and viewport-selection cost; the public
`createPhyloLensView` entry remains the client under test.

Every fixture advertises the same synthetic prepared global count of 100,000
nodes, above the 6,000-node small-tree path, while its returned snapshot varies
over the frozen seven-condition 999--39,999 primitive matrix. The public load
uses evaluation-specific `maxNodes=100000`, and the replay response must be
untruncated. Browser startup and deterministic replay-fixture generation are
outside timing. The primary interval is `t2 - t0`, from immediately before
`view.load()` through the second rAF after it resolves; it includes replay HTTP,
DTO processing, snapshot application, renderer work, and those two rAFs.

One retained warm-up and five fresh headed-Chromium measured observations run
per condition. Warm-ups describe OS/filesystem warming rather than persistent
browser/JIT state and never enter value summaries. The fixed post-load camera
input is only a frame-pacing stress diagnostic; its raw rAF intervals are not
interaction latency. GPU evidence must identify a hardware WebGL renderer and
reject software/SwiftShader paths. Process-tree RSS is published only when the
browser root and every recursively discovered live descendant are sampled;
root-only RSS is retained as diagnostic evidence but unavailable for publication
aggregate-memory statistics.

## RQ3: paired triangle-aggregation ablation

RQ3 compares `triangle_aggregation` with a full-detail counterfactual from the
same prepared layout and camera request. It does not add a public LoD-off
endpoint and does not prepare a second layout. The evaluation reader expands
each selected aggregate through persisted `cluster_members`, reads its original
coordinates from `node_positions`, and reads topology from `graph_edges`.
Missing membership is an explicit expansion failure. The semantic invariant is
the equality of the aggregate sum of `member_count` and the expanded detailed
node population.

Camera states are declarative world-bound requests (overview, intermediate,
and detail in the pilot). Both fixtures are serialized with sorted compact JSON
to obtain `payload_bytes_uncompressed`; primitives are nodes + edges + triangle
proxies. Conditions run in deterministic counterbalanced order with fresh RQ2
browser processes and reuse every RQ2 timing, heap, RSS, and frame metric.
Pair files retain metric-specific availability: for example, root-only RSS
does not invalidate latency but does invalidate process-tree RSS comparison.
These synthetic fixtures are not biological data, and the full-detail fixture
is an experimental counterfactual rather than a production endpoint.

## RQ4 preparation: internal snapshot-applied observer

RQ4 will observe the `t3` boundary through a private, opt-in diagnostics
observer attached to the specific view container before the view is created.
The observer fires synchronously after a successful renderer snapshot
application, before any subsequent frame measurement. It denotes renderer state
application, not paint, monitor scanout, or animation completion. Its callback
receives a constant-time immutable boundary first, so it can record `t3` before
requesting deferred immutable diagnostics such as aggregate hit coordinates and
the snapshot fingerprint. Measured callbacks retain that deferred reader until
after `t4`, so diagnostic enumeration cannot extend the measured frame window.
Neither stage exposes Sigma, Graphology, or other
renderer objects. It is evaluation-only internal infrastructure, not a public
library API or compatibility guarantee. Discovery, diagnostic construction, and
callback failures are isolated so they cannot change normal client behavior.

RQ4 uses `fresh_process_public_bootstrap_warm_session`: each repetition starts
a new server and browser, then completes the normal public `load()` path before
scenario setup and the measured input. It characterizes interaction after a
visualization is loaded, not startup, preparation, cold first use, WAN latency,
or physical display scanout. Server-backed operations use the first relevant
viewport dispatch as `t1`, the final relevant response that produced the
correlated snapshot as `t2`, the observer boundary as `t3`, and double-rAF as
`t4`; local collapse has no HTTP timing components.

The earlier pre-existing-layout-at-server-start condition is deliberately not
used: `PhyloLensView.load()` is the normal public operation that prepares and
publishes the graph. RQ4 therefore records the final published layout identity
after that unmeasured bootstrap and verifies deterministic input/configuration
produce equivalent identities across repetitions. No cache is artificially
cleared between `load()` and the interaction; process-local cache warming from
the same public bootstrap is the controlled warm-session state being measured.
For local collapse, the structural check is target-scoped: the cached
pre-expansion aggregate projection (aggregate id, represented-member count, and
incident-edge fingerprint) must reappear after collapse, and the collapsed
state must differ from the expanded snapshot. This matches production's merged
snapshot semantics without relying on renderer implementation identity.
