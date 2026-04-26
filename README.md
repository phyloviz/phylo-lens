# PhyloLens

Scalable phylogenetic visualization library.

## Project Goal

Build a modular system where phylogenetic semantics are separated from rendering,
allowing large datasets to be ingested, normalized, clustered by level of detail,
and visualized with predictable performance.

PhyloLens is not intended to render full graphs at large scale. The target
architecture is map-like semantic zoom:

- the server evolves from a normalizer into a data engine,
- hierarchical LoD representations are precomputed from topology,
- the client requests and renders only the visible slice for the current view.

## Architecture Baseline

Two-application model with strict boundaries:

- Server app
  - core: canonical domain model and invariants
  - data: parsing and normalization to canonical contracts
  - clustering: LoD construction and visible-slice selection for semantic zoom
- Client app
  - layout: graph positioning strategies
  - render: renderer adapter (Sigma first)
  - state: interaction and semantic-zoom orchestration

Baseline dependency direction:

- Server: core <- data <- clustering
- Client: state -> layout and render
- Cross-app: client depends only on server API contracts

## Scale Strategy

Large-scale interaction follows a hierarchical LoD pipeline rather than a
full-graph rendering pipeline:

1. ingest and normalize the full topology once,
2. precompute hierarchical clustering and subtree metadata on the server,
3. answer viewport-aware LoD queries from the client,
4. render only visible nodes and edges in Sigma.

This means current `CanonicalDataset` materialization is a correctness-first
baseline, not the final large-scale runtime model.

## Current Status

The active prototype already implements and tests the main tree-first LoD path:

1. deterministic normalization for Newick and edge-list inputs,
2. optional edge distance preservation in the canonical contract,
3. deterministic rooting/orientation for undirected tree-shaped datasets,
4. server-side hierarchy precompute with subtree metrics and stable coordinates,
5. viewport-aware visible-slice selection with contracted edges,
6. explicit cluster proxies carried into Sigma rendering.

This means the system is already beyond the "full dataset only" MVP. The
runtime flow is now:

1. `POST /dataset/prepare` normalizes and precomputes the hierarchy,
2. `POST /dataset/view-slice` returns only the bounded visible slice,
3. the client renders proxy-aware slices and can drill into collapsed subtrees.

Current limitations relative to the long-term architecture:

- hierarchy and selector internals are still Python-first and not yet memory-tuned for the largest targets,
- viewport-aware selection is tree-specialized and not yet generalized to weighted non-tree clustering,
- client interaction is LoD-aware, but broader caching and cluster analytics are still ahead.

## Implementation Notes For Thesis Writing

The current methodology can be described as a deterministic multistage LoD
pipeline:

1. parse and normalize source topology into `CanonicalDataset`,
2. orient tree-shaped inputs into a rooted parent-child form when needed,
3. build an indexed hierarchy from the oriented topology in explicit iterative passes,
4. answer visible-slice queries using zoom, subtree size, bounds, and viewport,
5. expose collapsed regions through representative proxy nodes rather than sending full subtrees.

The "proxy node" concept is important in the current implementation. A proxy is
the visible representative of a collapsed subtree. It keeps connectivity visible
at coarse levels and gives the client a deterministic drill-down handle without
materializing hidden descendants.

## Contribution And PR Policy (Thesis)

To keep the thesis work auditable and well-scoped, this repository follows a
strict PR-first workflow for `main`:

1. Direct commits to `main` are not allowed.
2. All changes must be submitted through a Pull Request.
3. At least 1 approval is required before merging.

Suggested workflow:

1. Create a branch from `main` using a short descriptive name.
2. Open a PR early and keep it focused on one concern (server, client, or docs).
3. Merge only after review approval.

## Documentation Index

- [Architecture Spec](docs/ARCHITECTURE_SPEC.md)
- [Architecture UML (PlantUML)](docs/architecture.puml)
- [Architecture Diagram (draw.io)](docs/architecture.drawio)
- [Implementation Checklist](docs/IMPLEMENTATION_CHECKLIST.md)
