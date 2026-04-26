# PhyloLens Implementation Checklist

This checklist turns the simplified architecture into executable phases.

## Progress Snapshot (2026-04-26)

Implemented and validated:

- [x] Server `core` contracts and invariants.
- [x] Server `data` normalization for Newick and edge-list.
- [x] `POST /dataset/normalize` endpoint and runtime error model.
- [x] Determinism and parser fixture tests on server.
- [x] Client normalization API module with runtime response guards.
- [x] Client renderer factory with Sigma and Mock adapters.
- [x] Client workbench orchestration (`normalize -> layout -> render`).
- [x] Client UI shell controller (framework-agnostic) with tests.
- [x] `POST /dataset/prepare` and `POST /dataset/view-slice` LoD endpoints.
- [x] Tree hierarchy precompute with deterministic rooting/orientation for undirected trees.
- [x] Viewport-aware visible-slice selection with contracted visible edges.
- [x] Explicit cluster proxy nodes and proxy-aware drill-down interaction.
- [x] Server benchmark harness for hierarchy build and visible-slice selection.

Pending for next phases:

- [ ] Stronger client-side caching around repeated slice requests.
- [ ] Broader Sigma interaction and UX polish for hierarchy navigation.
- [ ] Move metadata filtering execution to server ancillary pipeline via API-backed filter engine.
- [ ] Generalized weighted-graph hierarchy path beyond tree-specialized LoD.
- [ ] Tighter memory profiling and optimization for very large hierarchies.

## Current Thesis Tickets

- [x] `TASK-PL-003` Freeze hierarchy and visible-slice contracts for the LoD engine.
- [x] `TASK-PL-004` Implement tree hierarchy precompute MVP for LoD engine.

## Phase 0 - Server Core Kickoff (Immediate)

Goal: establish deterministic canonical ingest in server before broader client work.

- [ ] Create server module skeleton:
  - [ ] `code/server/core`
  - [ ] `code/server/data`
  - [ ] `code/server/api`
- [ ] Define canonical contracts in `core`:
  - [ ] `CanonicalNode`
  - [ ] `CanonicalEdge`
  - [ ] `CanonicalDataset`
- [ ] Implement core validators:
  - [ ] unique node ids
  - [ ] valid edge endpoints
  - [ ] metadata schema consistency
- [ ] Implement data normalization pipeline:
  - [ ] Newick adapter (minimum viable parser path)
  - [ ] edge-list adapter (if already available)
  - [ ] deterministic id and ordering policy
- [ ] Expose first endpoint in `api`:
  - [ ] `POST /dataset/normalize`
  - [ ] return dataset + ingest stats + warnings
- [ ] Add tests:
  - [ ] core invariant unit tests
  - [ ] data fixture tests
  - [ ] endpoint integration test
  - [ ] deterministic replay test

Exit criteria:

- [ ] Same input and options produce identical normalized output.
- [ ] Endpoint returns contract-valid payload for baseline fixtures.
- [ ] Core and data boundaries remain clean (no reverse imports).

## Phase 1 - Baseline Integration (Start Here)

Goal: make modules communicate end-to-end before clustering.

- [ ] Define shared contracts (`CanonicalDataset`, `PositionedGraph`) in one place.
- [ ] Implement Server `core` skeleton:
  - [ ] entity types
  - [ ] invariants/validators
- [ ] Implement Server `data` skeleton:
  - [ ] Newick input adapter
  - [ ] normalization to `CanonicalDataset`
  - [ ] metadata indexing
- [ ] Expose first server API endpoint:
  - [ ] `POST /dataset/normalize`
  - [ ] returns validated `CanonicalDataset`
- [ ] Implement Client `layout` (force-directed focus):
  - [ ] consume `CanonicalDataset`
  - [ ] produce `PositionedGraph`
- [ ] Implement Client `render` (Sigma adapter):
  - [ ] map `PositionedGraph` -> Graphology
  - [ ] render basic nodes/edges
- [ ] Implement Client `state`:
  - [ ] filter handling
  - [ ] selection handling
  - [ ] camera interaction hooks
- [ ] End-to-end test:
  - [ ] load dataset
  - [ ] compute layout
  - [ ] render + interact

Exit criteria:

- [ ] Data flows across Server `core+data` and Client `layout+render+state`.
- [ ] No schema mismatch between server response and client consumption.
- [ ] Stable interaction for at least one realistic dataset.

## Phase 2 - Clustering Activation

Goal: introduce semantic zoom via server-side clustering.

- [x] Freeze LoD contracts before implementation:
  - [x] `HierarchyIndex`
  - [x] `HierarchyCluster`
  - [x] `VisibleSliceQuery`
  - [x] `VisibleSliceResponse`
  - [x] deterministic and correctness invariants
  - [x] worked example across coarse/fine LoD
- [x] Implement Server `clustering` module API contracts.
- [ ] Integrate depth-based and threshold-based clustering engines.
- [x] Expose server clustering endpoints:
  - [x] `POST /dataset/view-slice`
  - [ ] optional future cluster build endpoints
- [x] Connect clustering output to Client `state` zoom bands.
- [x] Render cluster levels and level transitions in Client `render`.
- [x] Carry explicit cluster proxy metadata into the client contract.
- [x] Support proxy-click drill-down for collapsed subtrees.

Exit criteria:

- [ ] Semantic zoom works across at least 3 levels.
- [ ] Cluster membership remains deterministic.
- [ ] Interaction remains responsive during level transitions.

## Phase 3 - Performance and Hardening

Goal: scale and stabilize.

- [x] Add server benchmark harness (N=7 median) for hierarchy build and visible-slice selection.
- [ ] Add benchmark harness (N=7 median) for client render and interaction.
- [ ] Add optional Arrow path for ancillary metadata when needed.
- [ ] Add regression tests for contracts and clustering invariants.
- [ ] Profile memory and frame rate on large datasets.

Exit criteria:

- [ ] Meets agreed performance budgets for target dataset sizes.
- [ ] Reproducible benchmark results.
- [ ] Ready for broader library packaging.
