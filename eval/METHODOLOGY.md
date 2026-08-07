# RQ1 and RQ2 methodology

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

| Field | Definition |
| --- | --- |
| `wall_time_seconds` | Child monotonic elapsed time from direct-input normalization through artifact publication. |
| `stage_durations_seconds` | Duration of each named internal pipeline boundary in seconds. |
| `peak_rss_bytes` | Maximum sampled sum of RSS for the live child and recursively discovered live descendants. `peak_rss_scope` records a root-process fallback when process enumeration is unavailable. This is not an exact physical-memory high-water mark; short-lived peaks can occur between samples. |
| `input_bytes` | Byte size of the source input file. |
| `persisted_artifact_bytes` | Sum of `prepared_layout.sqlite3` and its `-wal` and `-shm` sidecars when present. Manifests, requests, logs, raw observations, summaries, and resolved configuration are outside the persistence directory and excluded. SQLite connections are closed after each repository operation; any remaining WAL/SHM files are counted rather than silently omitted. |
| `declared_node_count`, `declared_edge_count` | Dataset-catalog counts, if declared by the dataset metadata. |
| `observed_node_count`, `edge_count` | Counts in the normalized canonical dataset. A disagreement with declared counts preserves both values and emits a warning; it does not silently rewrite the catalog. |
| `lod_tier_count`, `cluster_count` | Distinct selected thresholds and materialized clusters in the produced artifacts. |
| `layout_status` | `ready` for Graphviz output or `degraded` when the service’s documented fallback is used. |

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
