# PhyloLens

Scalable phylogenetic visualization library.

## Project Goal

Build a modular system where phylogenetic semantics are separated from rendering,
allowing large datasets to be ingested, normalized, clustered by level of detail,
and visualized with predictable performance.

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

## Current Status

Current baseline is implemented and tested for:

1. Server normalization path (`POST /dataset/normalize`) for Newick and edge-list.
2. Client communication module with runtime contract checks.
3. Modular client render flow via workbench and renderer factory (Sigma + Mock adapters).

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

## Documentation Index

- [Architecture Spec](docs/ARCHITECTURE_SPEC.md)
- [Architecture UML (PlantUML)](docs/architecture.puml)
- [Architecture Diagram (draw.io)](docs/architecture.drawio)
- [Implementation Checklist](docs/IMPLEMENTATION_CHECKLIST.md)
