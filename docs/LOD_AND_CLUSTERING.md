# Level of detail and tree clusters

PhyloLens simplifies a tree for display. A cluster is a *pendant subtree*: a
connected set of original nodes attached to the remaining tree by one edge.
It is not a goeBURST clonal complex or an inferred biological founder.

## Technical roots

The unrooted goeBURST Full MST is oriented from one technical root. After
equivalent typing profiles are grouped, the PhyloLib Hamming matrix is read
row by row to count distances between distinct profiles. No second pairwise
distance calculation is needed. The root has
the most distance-1 neighbours (SLVs); ties compare distance-2 counts, then
distance-3 counts, and so on. An exact tie goes to the profile occurring first
in the original typing input. The choice does not use MST degree, edge lengths,
or the Newick serialization root. Each MST vertex must be a named profile.

Direct Newick input has no original profile-distance matrix, so each component
uses the root expressed by its Newick serialization. Anonymous internal nodes
are valid here. A direct Newick forest has one technical root per component.

Technical roots are explicit in `Dataset.technical_roots`; the source
records the rooting strategy. Both participate in the layout fingerprint.

## Hop-depth hierarchy

One hop is one tree edge, irrespective of its branch/allelic distance. Orient
each component from its technical root and assign every node its hop depth.
For a cut at depth `d`:

1. Nodes with depth at most `d` remain visible as singleton clusters.
2. Each connected child branch with depth greater than `d` is one collapsed
   cluster, represented by its member incident to the boundary edge.

The cut partitions all nodes exactly once. Every collapsed branch is connected
and has exactly one boundary edge. Its representative is only an attachment
point for drawing, not a founder. Contracting a branch cannot produce
`visible node -> collapsed cluster -> visible node`.

Increasing `d` reveals more of an existing branch. A node never moves between
unrelated clusters. Keeping distances on canonical edges preserves their data
and labels, but distances do not determine LoD membership.

Cluster membership is defined for any hop depth. A separate presentation policy
selects materialized levels using visible representation counts:

```text
n[k] = canonical nodes at hop depth k
R(d) = sum(n[k] for k <= d) + n[d + 1]
```

The final term is omitted at maximum depth. The rooted prefix is explicit and
each depth `d + 1` node attaches one complete descendant branch. Starting at
the coarsest cut, target `2.0 * R(current)` and choose the later cut nearest in
multiplicative terms (`abs(log(R(d) / target))`). A forward pass brackets each
target; ties prefer the smaller depth. Counts redundant with full detail are
omitted, keeping maximum depth as the explicit final level. There is no fixed
maximum number of levels. Full detail represents every original node individually.
The policy chooses among valid structural cuts; it cannot eliminate jumps
caused by the actual branching topology.

## Interaction: semantic zoom and viewport complexity

Semantic zoom expresses a preferred prepared tier, not a hard ceiling. Spatial
count queries inspect every prepared tier and select the finest one that meets
its viewport complexity target. Dense regions can defer the preferred tier;
sparse regions can refine beyond it. Each tier ahead of the zoom preference
halves the base target, requiring progressively more spare capacity. For a base
target of 1,000 representations, the preferred tier may contain 1,000; one tier
ahead may contain 500; two ahead may contain 250. Zoom therefore remains useful
without preventing early refinement in sparse regions.
Known small trees retain finest-tier preference but use the same density
selection on subsequent navigation. Explicit tier commands and pinned expansion
are exact. A complete cached overview is still reassessed during navigation.

The normal client derives the target from CSS-pixel screen area divided by
`lod.representationSpacingPx²` (default spacing 24 pixels). This is a tunable
visual density preference, not a count limit. A 15% hysteresis band retains the
previous effective tier near its zoom-adjusted target to prevent flicker.
Zoom thresholds also use a proportional 5% hysteresis band; the band shrinks
with deeper zoom, so no prepared tier becomes unreachable. The response's
`lod_level` reports the effective tier; the request's level remains zoom intent.

Selection uses unpadded visible bounds; retrieval uses padded bounds for
prefetch. Cluster counts use bounding-box overlap, matching cluster retrieval.
Finest-detail counts include the complete one-hop boundary-neighbor union.
Local counts need not be monotonic, so selection examines all prepared tiers
rather than stopping at the first dense cut. Only spatial counts are inspected;
intermediate graphs are not fetched or materialized during interaction.

If even the coarsest valid tier exceeds the target, it is returned complete.
No sibling grouping is invented and the target never causes SQL truncation.
Bounding-box overlap conservatively counts aggregates whose representative
position may be off-screen. Geometry, labels and overlapping edges can still
cause clutter: representation counts estimate complexity rather than guarantee
collision-free rendering.

Normal viewport and expansion requests have no node-count limit. Scalability
comes from aggregation, viewport bounds, spatial queries and progressive
structural refinement. An explicit caller may supply positive `max_nodes` (or
client `lod.maxNodes`) for a bounded request, without a server hard upper bound.
Only such explicit bounded reads can report count truncation. They are partial
views; normal navigation does not discard nodes after selecting a valid level.

Materialized cluster records total `sum R(d)`. Membership records still store
every canonical node at every selected level (`N * levels`); geometric cluster
counts do not imply linear storage for all prepared state.

## Prepared edges and expansion

At each level, an original edge within one cluster disappears from the
quotient view. An edge between clusters connects their representatives. Since
the input is a tree and each collapsed subtree has one boundary edge, the
quotient has no parallel edges and a multi-node collapsed cluster has degree
one. These properties are checked during preparation.

Expanding a cluster loads its original members and internal edges and surfaces
its attachment neighbour. Its single boundary edge becomes a meta-edge to
that neighbour's representative at the same level. Forest components remain
disconnected throughout.

The SQLite and PostgreSQL `prepared_clusters` rows record `lod_level`;
cluster members and prepared edges are keyed by the corresponding
layout version. Changing the root, rooting strategy or level-selection policy creates a new version.
