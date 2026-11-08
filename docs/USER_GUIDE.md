# PhyloLens user guide

## Load and explore a tree

In **Data**, choose a Newick tree or a typing-profile table and select **Load
dataset**. You can add an ancillary table to color and inspect the observations.
Use **Explore** for tree operations and **Appearance** for labels and colors.

Zoom changes how much detail is visible. Amber triangles are automatic groups;
violet triangles are branches you deliberately collapsed. Triangle sizes give a
compressed indication of the number of tree nodes. Hover or select a symbol for
exact available counts. A tree node and a biological isolate are different units.

A compact key beside the graph explains the group or connection symbols present
in the current view. Open **About symbols** for the size explanation. The key
updates as you expand, collapse or change views; it disappears when none of those
symbols are present. Exact counts remain available when hovering or selecting.

## Split a tree by distance

In **Data**, set **Maximum tree-edge distance**, then select **Load dataset**.
Every edge above that value is removed. Edges equal to the value are kept. All
nodes remain, including nodes that become isolated. The resulting trees appear
in **Forest overview** and their individual tree tabs.

For example, a cutoff of **3** keeps edges with distances 0, 1, 2 and 3 and
removes edges with distance 4 or greater. Decimal values are also supported.
Leave the field empty to keep every edge. To restore the original tree, clear
the field and load the same input again. A cutoff of **0** keeps zero-distance
edges; it does not mean “off”.

The distance is the value supplied on each tree edge. For a typing-derived MST,
it is the number of differing retained loci. For Newick, its meaning and units
come from the program that produced the tree. An edge length is not automatically
an allelic distance, a time or an evolutionary distance.
Thresholds use these numeric values, not the length of a line on screen.

Every edge needs a known distance for this operation. Missing values are not
treated as zero. If any are missing, supply a weighted input before applying a
cutoff. Removing labels or changing edge colors does not cut a tree.

Applying a cutoff rebuilds the layout and clears manual arrangements and folds.
It runs on the complete tree before automatic grouping, so a group cannot hide
an edge that should have been removed. Loading is explicit: scrolling and
changing the camera never rebuild the forest.

## Show additional distance connections

Load a dataset, then open **Explore → Additional distance connections**. Enter
the **Maximum pairwise distance** and select **Apply connections**. Blue links
show qualifying relationships that are absent from the tree. Original tree
edges remain, including edges longer than this threshold. Use the separate tree
cutoff if you want to remove long tree edges.

The displayed explanation identifies the distance used:

- **Typing profiles:** the number of differing retained loci, often called an
  n-locus variant or nLV threshold. Use a whole number. Missing loci follow the
  same policy as tree preparation: a locus containing allele `0` in any profile
  is excluded from every comparison. Equivalent profiles share one node.
- **Newick:** the sum of branch lengths along the path between two named nodes,
  also called patristic distance. For example, branches of 0.1 and 0.2 along a
  path give distance 0.3. Decimal thresholds are supported. This measures the
  supplied tree; it does not recover the original allelic differences.

Distances equal to the threshold are included. Distinct named Newick nodes can
have a zero-distance connection. Automatically generated structural junctions
are excluded as endpoints. Missing branch lengths produce an explanation.

Connections stay inside the current forest components: they never join trees
separated by a cutoff. They appear only when both endpoints are visible ordinary
nodes. Expanding a group or manual fold can reveal its nodes' connections;
collapsing it hides those links. The status reports visible and total additional
connections. It does not assign an invented distance to a triangle.

**Remove connections** restores the tree-only display. Applying or removing
connections keeps the current camera and manual arrangement. The extra links
are not springs and do not redefine a branch when dragging or collapsing it.
Automatic layout, if enabled, may continue moving the original tree as usual.

The default limit is **50,000 additional connections** across the loaded forest.
You can change it before applying. If more qualify, the operation reports this
and retains your previous overlay. It never silently shows an incomplete
selection. Larger thresholds can make computation and rendering expensive.
Connections are computed only when requested, not on every zoom. A new dataset
load clears them. No persistence across browser reloads is promised.

PNG exports with the legend enabled record the distance metric, threshold,
visible/total link count and any tree cutoff. For a publication, also record your
input, its provenance and any preprocessing choices.

## Evidence and limitations

Regression checks cover equality at the threshold, decimal and zero distances,
isolated nodes, retained node identities, missing values, forest components at
every prepared detail tier, and restoring the original layout version. These
are software correctness checks, not evidence of researcher task performance.
The [researcher walkthrough](validation/researcher-walkthrough.md) describes how
to collect that separate feedback.

Additional-connection checks compare the indexed algorithms with independent
tree-path and full Hamming calculations. They cover missing loci, equivalent
profiles, forest boundaries, zero and decimal paths, connection limits, obsolete
requests, folds and branch dragging. They do not establish an optimal threshold
or a biological grouping criterion for a particular study.
