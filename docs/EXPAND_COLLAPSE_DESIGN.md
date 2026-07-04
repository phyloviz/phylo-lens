# Cluster Expand / Collapse Design

Interactive expand and collapse of distance-based clusters, faithful to
PHYLOViZ 3.0 clade navigation and to branch-length correctness. This document is
a design proposal; it does not describe shipped behavior. It draws on the
`cytoscape.js-expand-collapse` extension for the meta-edge model while adapting
it to PhyloLens' server-side, threshold-driven architecture.

## Goals

1. Let a user collapse a clade into its representative and expand it back, as an
   explicit, reversible interaction — not only as a side effect of zooming.
2. Keep a collapsed clade **visibly connected** to the rest of the tree by
   rerouting its boundary edges to the representative (meta-edges). A collapsed
   clade that drops its external connections is biologically misleading.
3. Preserve branch-length fidelity: meta-edge distances stay server-computed and
   phylogenetically meaningful.
4. Add no redundant server round-trips for collapse of an already-expanded
   cluster.

## Current State (pre-design)

- **Server** (`api/v2_graph.py`): `GraphViewportQuery.cluster_id` already returns
  a cluster's members ignoring viewport bounds. `GraphViewportNode` carries
  `cluster_id`, `member_count`, `is_representative`, aggregated `metadata`,
  `x`, `y`, `layout_status`. `PreparedCluster` (server-only) holds
  `member_node_ids`, `internal_edge_ids`, `boundary_edge_ids`,
  `representative_node_id`, `threshold`.
- **Client** (`render/adapters/sigma/`): `GraphViewerV2.expandClusterFromClick`
  fires on `clickNode`, detects a representative via
  `isExpandableRepresentative`, re-queries with `cluster_id`, swaps the proxy for
  its members, and fits the camera.
- **Missing:** explicit stateful collapse; boundary-edge rerouting (meta-edges).
  `boundary_edge_ids` is computed but never sent to the client, and viewport
  edges are filtered to visible nodes — so a collapsed clade currently loses its
  external connections.

## Borrowed Model (Cytoscape.js) and How It Differs Here

Cytoscape collapse is a structural mutation: children are removed and stashed on
the parent (`collapsedChildren`); boundary edges are repointed to the compound
node and tagged as meta-edges carrying `originalEnds`; expand restores children
and repairs meta-edges via `findNewEnd`, which walks the parent chain to the
nearest currently-visible ancestor. The paper's invariant: **one meta-edge per
original edge**, extra state limited to a pointer to the true endpoints, making
results order-independent.

PhyloLens differs in one decisive way: **nearest-visible-ancestor resolution is
precomputed, not walked.** `partition_for_threshold(threshold)` already yields
`node_id -> cluster_id` at any LoD level, so "which representative does this
hidden endpoint map to right now" is an O(1) dict lookup rather than a runtime
tree walk. This keeps meta-edge resolution order-independent by construction and
cheaper than the reference implementation.

We do **not** adopt: fisheye sibling displacement, direct renderer-internal
mutation, or a separate cue `<canvas>` (the client already wires `clickNode`).

## Meta-Edge Model

For a collapsed cluster `C` with representative `R`:

- **Reroute (collapse).** For each edge in `C.boundary_edge_ids`, the endpoint
  inside `C` is replaced by `R`; the outside endpoint is unchanged. The edge is
  marked as a meta-edge and retains a pointer to its original endpoints.
- **One meta-edge per original edge.** No synthesized duplicates; the only extra
  state is the original endpoint pointer (mirrors the Cytoscape/PLOS invariant).
- **Distance.** A meta-edge's `distance` is the **minimum** boundary-edge
  distance between the outside node and any member of `C` — the closest approach
  into the clade, which a phylogeneticist reads as "how related is this outside
  taxon to this clade." Computed server-side, where all edge distances live.
- **Bundling.** When multiple boundary edges connect the same outside node to
  `C`, they collapse to a single meta-edge; the count is carried so the client
  may style it (e.g. thicker) — analogous to Cytoscape's collapsed-edge count.
- **Nested resolution.** If a meta-edge's true outside endpoint is itself inside
  another collapsed cluster at the current LoD, it routes to *that* cluster's
  representative (nearest visible representative), resolved via the current
  partition. A meta-edge demotes to a normal edge only when both endpoints are
  real, visible nodes again.

## Proposed Changes

### Server (`api/v2_graph.py`, `prepared_layout/`)

- When a returned slice contains a representative (collapsed cluster), include
  its **rerouted boundary edges** in `response.edges`, with `source`/`target`
  set to the visible representative(s) and `distance` = min boundary-edge
  distance to the outside endpoint. This restores the existing invariant that
  every visible edge references returned visible nodes.
- Extend `GraphViewportEdge` with optional `is_meta: bool` and a bundled-edge
  count so the client can distinguish and style meta-edges. Real-edge behavior
  and all existing fields are unchanged.
- Do not leak internal metadata keys (`__category_count__*`, `profile_count`)
  into meta-edge or proxy payloads.

### Client (`render/adapters/sigma/`)

- Track an `expandedClusterIds` set plus a per-cluster cache of member
  attributes returned by the first expand (the `collapsedChildren` analog).
- Add `collapseCluster(clusterId)`: remove cached members, re-add the
  representative, restore meta-edges — no server round-trip when cached.
- Wire a collapse affordance symmetric to the existing expand (e.g. re-click /
  double-click a representative to expand, an equivalent gesture to collapse).

## Phasing

- **Phase 1:** explicit collapse state + collapse action **and** server-side
  boundary-edge rerouting with min-distance meta-edges. These share the same
  edge-set / expanded-state seam and are designed together.
- **Phase 2 (later):** meta-edge bundling styling on the client.
- **Phase 3 (later):** undo/redo history following the Cytoscape
  `undoRedoUtilities` pattern — capture pre-expand positions and restore them
  verbatim on collapse instead of re-running layout, so collapse returns to the
  pixel-identical prior overview.

## Correctness Invariants (proposed)

- Every visible edge, including meta-edges, references returned visible nodes.
- Exactly one meta-edge per original boundary edge (after bundling, one per
  outside-endpoint / cluster pair); no duplicates across expand/collapse cycles.
- Expand then collapse (and the reverse) returns to an equivalent slice; with
  Phase 3, to pixel-identical positions.
- Meta-edge distances are server-computed minimum boundary distances; the client
  never fabricates a distance.
- `<=` partition semantics, aggregation rules (mode categorical/boolean, mean
  numeric), and internal-key filtering are unchanged.

## Docs to Reconcile (stale references)

These predate the v2 viewport model and should be updated when this ships:

- `ARCHITECTURE_SPEC.md:102` references `lod/clusterExpansion.ts`, which does not
  exist; expansion lives in `GraphViewerV2.expandClusterFromClick`.
- `ARCHITECTURE_SPEC.md:256` lists proxy fields `is_cluster_proxy`,
  `subtree_size`, `leaf_count`; v2 uses `is_representative` and `member_count`.
- `flow.md:81-83` shows proxy click sending `focus_node_id`; v2 sends
  `cluster_id`.
