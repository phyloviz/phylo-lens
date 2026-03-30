# Phylogenetic Visualization Library Architecture (Thesis)

## 1) Purpose

Define a modular architecture for a scalable, phylogeny-aware visualization library where:

- biological/topological semantics are independent from rendering technology,
- semantic zoom is driven by deterministic LoD clusters,
- rendering backends (Sigma now, others later) are adapters.

This document is the source of truth for implementation decisions in the PoC-to-library transition.

## 2) Scope and Non-Goals

### In scope

- Canonical data model for trees/graphs and metadata.
- Parsing and normalization pipeline (Newick and edge-list first, typing-data path next).
- LoD generation contracts (C core + Python orchestration).
- Layout module contracts (force/radial/dendrogram).
- Renderer adapter contracts (Sigma.js first).
- Interaction and state contracts for semantic zoom/filtering.
- Performance and correctness acceptance criteria.

### Out of scope (for first release)

- Full phylogenetic inference algorithms.
- Domain-specific analytics UI beyond visualization primitives.
- Multi-user collaboration features.

## 3) Architectural Principles

1. **Semantics-first**: biological correctness lives in `core`, not in the renderer.
2. **Deterministic pipeline**: same input + config => same normalized model and LoD outputs.
3. **Renderer-agnostic contracts**: Sigma-specific code must not leak into domain modules.
4. **Scale-aware by design**: precomputation and indexing before runtime interaction.
5. **Observable performance**: every stage exposes timings and memory-friendly metrics.

## 4) Module Map (Simplified)

Architecture is split into two applications with three modules each.

### Server App

## `core`

Responsibilities:

- Canonical entities and invariants (`Node`, `Edge`, `Tree`, metadata contracts).
- Validation and deterministic rules shared by server processing.

## `data`

Responsibilities:

- Input adapters: Newick parser bridge, edge-list loaders, future typing-data adapters.
- Normalization to canonical model.
- Metadata alignment and indexing.
- Optional columnar serialization for ancillary metadata using Apache Arrow.

Output: `CanonicalDataset` as ingest baseline plus persisted topology artifacts
consumed by LoD services.

## `clustering`

Responsibilities:

- Generate cluster levels (`LodBundle`) from topology.
- Precompute subtree statistics required for semantic zoom.
- Persist hierarchy indexes for later view queries.
- Host threshold/depth clustering strategies.
- Provide stable cluster identity mapping across levels.

Status:

- Planned module.
- Intentionally deferred in first integration phase to establish clean `core <-> data` flow first.

### Client App

## `layout`

Responsibilities:

- Compute positions for current visualization mode.
- Initial focus: force-directed layout.
- Future extensibility: radial and dendrogram strategies.

Output: `PositionedGraph`.

## `render`

Responsibilities:

- Translate `PositionedGraph` + visual mapping into Graphology/Sigma attributes.
- Manage Sigma-specific programs (e.g., piechart nodes).
- Apply reducers and rendering-side optimizations.

No biology decisions here.

## `state`

Responsibilities:

- View state machine: active filters, selection, camera, zoom bands.
- Event orchestration between interaction and layout/render updates.
- Performance-safe refresh cadence (throttle/debounce policies).
- Visible-slice caching and orchestration for viewport-aware LoD queries.
- Filtering execution currently starts client-side behind a pluggable filter engine boundary and is intended to move server-side with ancillary data services as scale grows.

## 5) Canonical Contracts (v0.1)

## `CanonicalDataset`

```ts
interface CanonicalDataset {
  datasetId: string;
  nodes: CanonicalNode[];
  edges: CanonicalEdge[];
  metadataSchema: MetadataField[];
  metadataByNodeId: Record<
    string,
    Record<string, string | number | boolean | null>
  >;
  source: {
    format: "newick" | "edgelist" | "typing_data";
    generatedAt: string;
    provenance?: string;
  };
}
```

## `LodBundle`

```ts
interface LodBundle {
  datasetId: string;
  levels: LodLevel[]; // ordered coarse -> fine
  mapping: {
    childClusterToParentCluster: Record<string, string>;
    nodeToLeafCluster: Record<string, string>;
  };
}

interface LodLevel {
  level: number;
  cutoffDepth?: number;
  clusters: LodCluster[];
}

interface LodCluster {
  clusterId: string;
  memberNodeIds: string[];
  representativeNodeId?: string;
  aggregates?: Record<string, number | string>;
}
```

## `HierarchyIndex`

```ts
interface HierarchyIndex {
  datasetId: string;
  rootClusterId: string;
  clusters: Record<string, HierarchyCluster>;
}

interface HierarchyCluster {
  clusterId: string;
  parentClusterId?: string;
  childClusterIds: string[];
  representativeNodeId?: string;
  subtreeSize: number;
  depth: number;
  minDepth: number;
  maxDepth: number;
  centroid?: { x: number; y: number };
  bounds?: { minX: number; minY: number; maxX: number; maxY: number };
  aggregateMetadata?: Record<string, string | number | boolean | null>;
}
```

This is the server-side index used to answer semantic-zoom queries. It is not
intended to be fully shipped to the browser for large datasets.

## `VisibleSliceResponse`

```ts
interface VisibleSliceResponse {
  datasetId: string;
  lodLevel: number;
  nodes: CanonicalNode[];
  edges: CanonicalEdge[];
  collapsedClusters: Array<{
    clusterId: string;
    representativeNodeId?: string;
    subtreeSize: number;
    centroid?: { x: number; y: number };
  }>;
  viewMeta: {
    viewport: { x: number; y: number; width: number; height: number };
    zoom: number;
    returnedNodeCount: number;
    returnedEdgeCount: number;
  };
}
```

This contract represents the runtime payload for the client. The design target
is to return `O(visible_nodes)` data rather than the full topology.

## `PositionedGraph`

```ts
interface PositionedGraph {
  nodes: Array<{
    id: string;
    x: number;
    y: number;
    size?: number;
    color?: string;
    attributes?: Record<string, unknown>;
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
    attributes?: Record<string, unknown>;
  }>;
  viewMeta: {
    layout: "force" | "radial" | "dendrogram";
    lodLevel: number;
  };
}
```

## `ArrowAncillaryBundle` (Optional)

```ts
interface ArrowAncillaryBundle {
  datasetId: string;
  schemaVersion: string;
  scope: "node" | "cluster" | "mixed";
  batches: Array<{
    batchId: string;
    format: "apache-arrow";
    rowCount: number;
    contentEncoding?: "none" | "zstd";
  }>;
}
```

### Transport strategy

- **Hybrid when needed**:
  - topology/LoD view slices remain in compact JSON contracts,
  - ancillary/filter-heavy metadata is transported as Arrow batches.
- This preserves implementation simplicity for graph structure while optimizing large attribute payloads.

## 6) Processing Pipeline (Current Focus)

1. **Client Input**: upload/select dataset and initial visualization config.
2. **Client -> Server API**: submit ingest/normalize request.
3. **Server / Core+Data Integration**: ingest, validate, normalize, index.
4. **Server -> Client Response**: return `CanonicalDataset`.
5. **Client / Workbench Orchestration**: normalize -> layout -> render handoff.
6. **Client / Layout**: compute deterministic positioned graph for small trees.
7. **Client / Render Adapter**: route rendering through factory-selected adapters.

## 6.1) Processing Pipeline (Next Phase)

1. Enable **Server / Clustering** module and persist `HierarchyIndex` outputs.
2. Precompute subtree metadata such as size, centroid, and depth ranges.
3. Expose server-side visible-slice query endpoints keyed by viewport and zoom band.
4. Connect semantic zoom bands in client state to server LoD selection.
5. Add Arrow ancillary path only where metadata transfer becomes a bottleneck.

## 7) Interaction Model for Semantic Zoom

- Define zoom bands (example):
  - Band 0: overview clusters,
  - Band 1..N-2: intermediate clusters,
  - Band N-1: leaf-level detail.
- Camera zoom crossing a band boundary updates active LoD level.
- Viewport and zoom together select the visible slice returned by the server.
- Transition policy:
  - preserve camera focus point,
  - stable cluster identity across adjacent levels,
  - optional animated interpolation by adapter.
- Off-screen regions should remain collapsed as cluster representatives rather
  than expanded into raw nodes.

## 8) Performance Budgets (Initial)

Target budgets (to be adjusted by benchmarking evidence):

- Load + normalize (100k nodes): <= 2.5s median.
- LoD build (100k nodes): <= 1.5s median offline/precompute path.
- Filter toggle response (active view): <= 120ms p95.
- Zoom-band LoD switch: <= 180ms p95.
- Pan/zoom interaction: >= 30 FPS on thesis test machine for target mode.
- Visible-slice query complexity should be proportional to the returned slice
  plus hierarchy navigation cost, not to total dataset size.

## 9) Correctness Gates

- Cluster membership conservation across levels.
- No node loss when moving from coarse to fine LoD.
- Edge endpoint validity after every transformation.
- Metadata aggregation reproducibility.
- Deterministic output for same seed/config where applicable.

## 10) Milestones

### M1 — Contract Freeze

- Freeze `CanonicalDataset`, `LodBundle`, `PositionedGraph` schemas.
- Add JSON fixtures and schema validation tests.

### M2 — Server Core+Data First

- Integrate `core` and `data` modules with stable API contracts.
- Validate end-to-end data flow to client layout/render/state path.

### M3 — LoD Data Engine

- Persist hierarchy indexes and subtree statistics from normalized topology.
- Define visible-slice query contracts and tests.
- Demonstrate semantic-zoom queries without full-dataset transfer.

### M4 — Client Semantic Zoom Runtime

- Replace full-graph client state with visible-slice orchestration.
- Add viewport-aware fetch, cache, and bounded Sigma updates.
- Validate interaction budgets on thesis benchmark datasets.

### M5 — Clustering Module Activation

- Integrate C clustering module through Python API in `processing_module`.
- Persist LoD artifacts for frontend consumption.

### M4 — Layout Abstractions

- Implement radial layout adapter first.
- Add dendrogram layout contract and initial edge-shape mapping.

### M5 — Sigma Adapter Hardening

- Isolate renderer mapping and reducers.
- Add size metric and visual mapping configuration.

### M6 — Benchmark + Evaluation

- Run N=7 median benchmarks for agreed datasets.
- Compare modes and report against thesis criteria.

## 11) Suggested Repo Structure (Library-Oriented)

```text
solution_poc/
  architecture/
    ARCHITECTURE_SPEC.md
    architecture.puml
    architecture.drawio
  processing_module/
    hierarichal_clustering.c
    hierarchical_clustering.py
    api.py
  sigmajs/
    poc-01/
```

Future (when graduating from PoC):

```text
library/
  packages/
    server/
      core/
      data/
      clustering/
    client/
      layout/
      render/
      state/
```

## 12) Decision Log (Initial)

- Architecture is organized as two apps with a 3+3 module split: Server (`core`, `data`, `clustering`) and Client (`layout`, `render`, `state`).
- First delivery prioritizes working integration between `core` and `data` on server and `layout`/`render`/`state` on client.
- `clustering` is planned and intentionally deferred until base module integration is stable.
- Sigma.js is the initial render backend; force-directed is the initial layout strategy.
- Arrow remains optional for ancillary metadata transport when scale demands it.

## 13) Server Core Kickoff Blueprint (Immediate)

This section translates the architecture into a concrete starting point for the
first coding sprint.

### 13.1) Module Boundaries for Sprint 1

Server `core` owns:

- canonical types (`CanonicalNode`, `CanonicalEdge`, `CanonicalDataset`),
- deterministic validation rules,
- domain-level error taxonomy.

Server `data` owns:

- source parsing adapters,
- normalization into core contracts,
- metadata indexing and ingest metrics.

Boundary rule:

- `data` may use `core` types and validators.
- `core` must not import parser or transport concerns.

### 13.2) Determinism Rules (Required)

For the same input and configuration:

- node ordering in output is stable,
- edge ordering in output is stable,
- generated ids are stable,
- validation results are reproducible.

Recommended implementation pattern:

- canonical sort by id,
- explicit id strategy (source id or reproducible hash),
- no runtime-random ordering dependence.

### 13.3) First Endpoint Contract

`POST /dataset/normalize`

Request (conceptual):

- `format`: `newick | edgelist`
- `datasetName`: string
- `content`: string or structured payload
- `options`: parser and normalization options

Response (conceptual):

- `dataset`: `CanonicalDataset`
- `stats`: `{ nodeCount, edgeCount, ingestMs, normalizeMs }`
- `warnings`: string[]

Error model:

- `400` invalid input format/content
- `422` semantic validation failure (violates invariants)
- `500` unexpected server error

### 13.4) Invariants to Enforce in Core

- every node id is unique and non-empty,
- every edge references existing node ids,
- no self-loop unless explicitly allowed by config,
- graph component consistency is validated,
- metadata keys match declared schema.

### 13.5) Test Gate for Sprint 1

Minimum tests before enabling clustering work:

- unit tests for each invariant in `core`,
- parser-normalizer tests in `data` with fixed fixtures,
- endpoint integration test for `POST /dataset/normalize`,
- deterministic replay test: same input produces byte-equivalent canonical output
  after normalized ordering.

Exit to next phase only when these tests pass consistently.
