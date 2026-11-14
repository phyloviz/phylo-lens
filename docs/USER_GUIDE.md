# PhyloLens user guide

## Load and explore a tree

In **Data**, choose a Newick tree or a typing-profile table and select **Load
dataset**. You can add an ancillary table to color and inspect the observations.
Use **Explore** for tree operations and **Appearance** for labels and colors.

Zoom changes how much detail is visible. Amber triangles are automatic groups;
violet triangles are branches you deliberately collapsed. Triangle sizes give a
compressed indication of the number of tree nodes. Hover or select a symbol for
exact available counts. A tree node and a biological isolate are different units.

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

Every edge needs a known distance for this operation. Missing values are not
treated as zero. If any are missing, supply a weighted input before applying a
cutoff. Removing labels or changing edge colors does not cut a tree.

Applying a cutoff rebuilds the layout and clears manual arrangements and folds.
It runs on the complete tree before automatic grouping, so a group cannot hide
an edge that should have been removed. Loading is explicit: scrolling and
changing the camera never rebuild the forest.

## Evidence and limitations

Regression checks cover equality at the threshold, decimal and zero distances,
isolated nodes, retained node identities, missing values, forest components at
every prepared detail tier, and restoring the original layout version. These
are software correctness checks, not evidence of researcher task performance.
The [researcher walkthrough](validation/researcher-walkthrough.md) describes how
to collect that separate feedback.
