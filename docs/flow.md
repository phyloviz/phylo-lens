# PhyloLens Runtime Flow

End-to-end runtime for the v2 architecture: one `prepare` (submitted async, then
polled) to materialize the layout, then repeated bounded `viewport` reads driven
by the camera. For the data contracts see [`DATA_MODEL.md`](./DATA_MODEL.md); for
tier selection see [`LOD_AND_CLUSTERING.md`](./LOD_AND_CLUSTERING.md); for the
prepare job flow see [`SERVER_PIPELINE.md`](./SERVER_PIPELINE.md#async-job-flow).

```mermaid
flowchart TD
    A["renderNewick(newick, metadata)"] --> B["POST /api/v2/graph/prepare
    (NormalizeRequest)"]

    B --> C["normalize_dataset -> CanonicalDataset (sync)
    deterministic node/edge ids
    branch lengths as edge distances"]
    C --> C2["ensure_graph_v2_edge_distances
    fill missing distance = 1.0"]

    C2 --> SUB["submit to background worker
    return 202 { job_id, status: pending }"]

    SUB --> POLL["client polls GET /prepare/{job_id}
    (DEFAULT_PREPARE_POLL_INTERVAL_MS)"]

    POLL --> D["ingest (on worker): select up to 16 distance thresholds
    Union-Find components per threshold
    medoid representative per cluster"]

    D --> E["layout (Graphviz sfdp, no timeout):
    global node positions
    cluster positions, radius, bounds
    degrade to circular fallback if sfdp unavailable"]

    D --> F["compute_prepared_edges:
    per-tier quotient edge lists
    (representative-to-representative, min distance)"]

    E --> G["persist to SQLite
    keyed by (dataset_id, layout_version)"]
    F --> G

    G --> H["status ready -> GraphV2PrepareResponse
    lod_tier_count, layout_status, warnings"]

    H --> I["startGraphV2ViewportSync(lodTierCount)"]

    I --> J["POST /api/v2/graph/viewport
    dataset_id, layout_version
    bounds, zoom, lod_level, max_nodes"]

    J --> K{"read_viewport path"}
    K -->|cluster_id set| K1["expand cluster into members
    + reroute boundary edges as meta-edges"]
    K -->|lod_level 0, no bounds| K2["overview representatives"]
    K -->|threshold is None| K3["finest 'ready' node positions in bounds"]
    K -->|else| K4["representatives at level's threshold, in bounds"]

    K1 --> L["GraphViewportResponse
    nodes, edges, total_node_count, truncated"]
    K2 --> L
    K3 --> L
    K4 --> L

    L --> M["syncGraphologyViewport + reconcileGraphologyViewport
    triangle proxies, PHYLOViZ role colors, metadata mapping"]

    M --> N["Sigma renders the slice"]

    N --> O{"User interacts?"}

    O -->|Pan / zoom| P["semanticLodLevelForCameraRatioWithHysteresis
    pick tier; debounced 60ms (LoD) / 120ms (pan)"]
    P --> J

    O -->|Single-click representative| Q["snapshot proxy,
    query cluster_id (lod_level=null),
    swap proxy for members, fit camera"]
    Q --> J

    O -->|Double-click representative| R["collapseCluster:
    restore proxy from client cache
    (no server round-trip)"]
    R --> N
```
