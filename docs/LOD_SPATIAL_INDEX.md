# LoD And Spatial Indexing

This document describes the active scalable rendering path in PhyloLens. The
design follows a map-style model: expensive global work is performed offline
during `prepare`, and interaction is handled through low-latency viewport
queries.

## Problem

Large phylogenetic datasets cannot be rendered as full node-link graphs in the
browser while preserving predictable interaction. Even if Sigma can render a
large graph, transferring and updating the full topology on every zoom/pan
operation does not scale.

PhyloLens therefore treats the server as a data engine:

- ingest the full topology once;
- precompute LoD and spatial structures;
- answer visible-slice queries for the current camera viewport.

## Prepare-Time Pipeline

```text
CanonicalDataset
  -> weighted edge sort
  -> Union-Find threshold levels
  -> ThresholdHierarchyIndex
  -> representative coordinates
  -> cluster bounds
  -> STR spatial indexes by LoD level
```

### Threshold Hierarchy

`threshold_hierarchy.py` builds a deterministic hierarchy from weighted edges.
For each selected distance threshold, Union-Find computes connected components.
Those components become clusters ordered from coarse to fine levels.

The hierarchy stores:

- parent/child cluster relationships;
- representative node ids;
- member node ids;
- `subtree_size`;
- threshold level and threshold value;
- centroid and axis-aligned bounds.

This is a pragmatic approximation of semantic zoom for weighted phylogenetic
topologies: coarse views show larger connected regions, while deeper views
reveal finer components.

### Global Coordinate Space

Cluster centroids and bounds are computed once on the server. The root cluster
produces `global_bounds`, which defines the coordinate system used by:

- Sigma camera updates;
- visible-slice viewport queries;
- spatial index lookups.

The client must not derive future query bounds from the currently rendered
slice. It uses `global_bounds` to keep pan/zoom behavior stable across refreshes.

## STR-Packed R-tree

An R-tree indexes bounding boxes. It answers this question efficiently:

```text
Which clusters at this LoD level intersect the camera viewport?
```

PhyloLens uses a static STR-packed variant because all cluster bounds are known
after `prepare`.

STR means **Sort-Tile-Recursive**:

1. sort entries by x center;
2. split into x slices;
3. sort each slice by y center;
4. pack fixed-size leaf nodes;
5. recursively pack parent nodes until one root remains.

The implementation is in `spatial_index.py`.

Each `SpatialLevelIndex` contains:

- `level`;
- `root_node_index`;
- flat `nodes` array.

Each `SpatialIndexNode` contains:

- `bounds`;
- `child_node_indices` for internal nodes;
- `cluster_ids` for leaf nodes.

The flat-array representation is deliberate. It is easier to persist, cheaper
to traverse than nested Pydantic objects, and closer to a future lower-level
implementation.

## View-Slice Query

At interaction time:

```text
VisibleSliceQuery
  -> viewport bounds
  -> target LoD level
  -> STR queries for levels <= target
  -> candidate cluster ids
  -> hierarchy expansion
  -> visible nodes/edges/proxies
```

The selector keeps two guarantees:

- off-camera branches are not expanded unless they are part of an explicit focus
  path;
- proxy drill-down can still force a path deeper into the hierarchy.

If a prepared hierarchy does not contain spatial indexes, the selector falls
back to direct bounding-box overlap checks. This keeps old fixtures and partial
records usable.

## Complexity

Without a spatial index, candidate discovery requires scanning many cluster
bounds. With the STR index, candidate discovery is closer to:

```text
O(log n + k)
```

where `k` is the number of indexed clusters intersecting the viewport. The exact
constant depends on node capacity, overlap between bounding boxes, and LoD
distribution.

The end-to-end query still includes hierarchy expansion and edge construction,
so benchmarks should measure the whole `view-slice` operation, not only the
index lookup.

## Current Limitations

- Threshold selection is fixed and still needs interaction-oriented tuning.
- The index is persisted as Pydantic models; this is clean but not the final
  memory layout for very large targets.
- No cache is used for repeated viewport/zoom queries yet.
- Metadata filters are still primarily client-side.
- Label density is not yet part of LoD selection.

## Benchmark Targets

Measure at least:

- hierarchy build time;
- STR index build time;
- peak memory during prepare;
- visible-slice query time for overview, mid-zoom, and focused detail;
- returned node, edge, and proxy counts.

Useful comparisons:

- spatial-index selection vs direct overlap selection;
- different STR node capacities;
- different threshold-level policies.

These measurements should drive any future C or lower-level implementation.
