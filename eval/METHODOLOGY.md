# RQ1 methodology

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
