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
  - clustering: LoD construction for semantic zoom (next phase)
- Client app
  - layout: graph positioning strategies
  - render: renderer adapter (Sigma first)
  - state: interaction and semantic-zoom orchestration

Baseline dependency direction:

- Server: core <- data <- clustering
- Client: state -> layout and render
- Cross-app: client depends only on server API contracts

## Immediate Thesis Focus

Current implementation focus is Server core plus data integration:

1. Freeze CanonicalDataset contract.
2. Implement deterministic normalization endpoint.
3. Deliver stable payload to client layout and render flow.

This is the smallest vertical slice that proves architecture integrity before
clustering and advanced performance paths.

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

Current baseline is implemented and tested for:

1. Server normalization path (`POST /dataset/normalize`) for Newick and edge-list.
2. Client communication module with runtime contract checks.
3. Modular client render flow via workbench and renderer factory (Sigma + Mock adapters).

Current limitations relative to the target architecture:

- the active API still returns full normalized datasets,
- the client still builds and stores full positioned graphs,
- LoD hierarchy construction and viewport-aware querying are not active yet.

## Suggested First Server Slice

Target endpoint:

- POST /dataset/normalize

Input:

- dataset payload (Newick or edge-list source)
- optional ingest configuration

Output:

- validated CanonicalDataset
- deterministic metadata indexes
- basic ingest statistics (counts and timings)

Implementation order:

1. core entities and validators
2. data parser adapter and normalizer
3. endpoint wiring and schema tests

## Next Architecture Slice

The next thesis-critical slice is not parser micro-optimization, but LoD
infrastructure:

1. define hierarchy and visible-slice contracts,
2. precompute cluster hierarchy plus subtree statistics,
3. expose server-side view queries,
4. switch client orchestration from full-graph mode to visible-slice mode.

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
