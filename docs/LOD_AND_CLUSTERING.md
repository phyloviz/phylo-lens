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

Technical roots are explicit in `CanonicalDataset.technical_roots`; the source
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

Cluster membership is defined for any hop depth. The public LoD levels select
at most 12 deterministic depths: zero, increasing powers of two, and the
maximum depth for complete detail. Selection of these cuts is a presentation
policy independent of the cluster rule. At the finest level the viewport can
read individual positioned nodes.

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
layout version. Changing the root or rooting strategy creates a new version.
