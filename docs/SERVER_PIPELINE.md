# Server preparation pipeline

`POST /api/graph/prepare` turns a Newick tree or an allelic-profile table into a
stored graph with node positions and levels of detail (LoD). Once preparation
finishes, the server can answer viewport, region, and search requests from the
stored data without laying out the whole graph again.

```text
request validation
  → local capacity check, when using local jobs
  → input parsing and normalization
  → layout version and subtree clusters
  → storage of the dataset and clusters as refining
  → edges for each level of detail
  → global layout
  → storage of positions and prepared edges
  → publication as ready
```

## 1. Request validation

FastAPI checks the request fields before preparation starts. The request contains:

- source format and content;
- dataset name;
- options for handling self-loops;
- optional node metadata and field types;
- optional ancillary CSV/TSV data;
- optional Graphviz `sfdp` settings.

Malformed HTTP requests return `422`. Input parsing and validation errors are
listed in the [API reference](./API_REFERENCE.md).

## 2. Preparation jobs

### Local backend

The local job registry limits the number of active preparation jobs. It reserves
a place before parsing the input, including before any PhyloLib calculation.
The reservation is released if parsing fails. Otherwise, it is held until the
background job finishes.

The registry can reuse an active or successfully completed job with the same
`(dataset_id, layout_version)`. Failed jobs are not reused. Completed jobs keep
a small response with counts and status, rather than the whole prepared graph
in memory.

### PostgreSQL backend

The API first parses and normalizes the input, then stores a preparation job in
PostgreSQL. External workers claim these jobs using row locks. Each worker has
a time-limited lease that it renews while working. Stored jobs and graph data
survive an API restart.

## 3. Input parsing and normalization

`normalize_dataset` converts either input format into the same internal dataset
structure, `CanonicalDataset`.

### Newick input

```text
Newick text
  → parse one tree or a forest
  → assign node identifiers
  → record edges, branch lengths, and component roots
  → join metadata and ancillary data
  → validate the dataset
```

### Typing-data input

```text
allelic-profile table
  → identify distinct profiles and their isolates
  → PhyloLib Hamming distance calculation
  → PhyloLib goeBURST Full MST
  → choose a technical root
  → group identical profiles into one node
  → join isolate metadata and build profile summaries
  → validate the dataset
```

The result is a minimum spanning tree of distinct profiles. Each profile node
keeps the identifiers and metadata of its isolates. Ancillary data does not
change the goeBURST tree.

### Branch lengths and allelic distances

Supplied branch lengths and allelic distances are stored on the edges. Missing
Newick branch lengths remain absent, including when only some branches have
lengths. Preparation does not require a distance on every edge.

These values do not determine subtree clusters or node positions. In particular,
the geometric length of a drawn edge does not encode its branch length or
allelic distance. Use distance labels to read the supplied values.

### Metadata

Normalization checks declared field types and infers types for other fields.
Ancillary rows are matched by identifier, using either an exact match or a
normalized identifier. Directly supplied metadata takes precedence when fields
conflict.

For typing data, each isolate can have at most one ancillary row. Isolates with
an identical profile share a graph node, but their individual records are kept.
Profile summaries combine their metadata; for example, a declared numeric field
uses the mean of the available isolate values. Newick nodes can have multiple
ancillary rows. Internal summary fields are hidden from public metadata schemas.

The server also records parsing and normalization times for internal diagnostics.
These times are not included in the public preparation response.

## 4. Dataset and tree validation

Dataset validation checks:

- non-empty, unique node and edge identifiers;
- edge endpoints that exist in the dataset;
- the requested self-loop policy;
- metadata values and declared field types;
- reserved metadata field names.

Preparation also requires at least one node and a tree or forest. It rejects
cycles, self-loops, and repeated edges between the same pair of nodes. Each tree
component must have exactly one technical root. Missing edge distances are
allowed.

## 5. Layout versions

`layout_version_for_dataset` creates a repeatable version identifier from:

- the pipeline version and LoD growth factor;
- the resolved `sfdp` settings;
- the dataset identifier;
- nodes, edges, and supplied distances;
- component roots and rooting strategy;
- metadata, ancillary rows, and isolate records;
- source format and provenance.

The generation timestamp is excluded. Nodes and edges are sorted, and the data
is serialized consistently before computing the identifier.

This identifier allows the server to reuse preparation jobs and distinguish
stored versions. Changing a distance or metadata value creates a new version,
even though those values do not control the layout geometry.

## 6. Subtree levels of detail

For typing data, PhyloLens chooses a technical root using the goeBURST LV counts:
first single-locus variants (SLVs), then double-locus variants (DLVs), and then
successive allelic distances. Original input order breaks a final tie. For
Newick input, it keeps the parsed root of each tree component. A technical root
organizes the display; it does not establish an evolutionary ancestor.

Depth is measured in hops: one hop is one tree edge, regardless of its distance.
At a chosen depth, nodes from the root down to that depth remain individual
nodes. Each remaining branch is collapsed into a connected subtree attached by
one edge. The node at the attachment end of that subtree represents it in the
coarse view.

Successive LoD levels aim to roughly double the number of displayed nodes and
collapsed subtrees. The pipeline chooses the available depth closest to that
target by ratio. There is no fixed limit on the number of levels. The final
level shows every original node individually. Some trees, such as stars,
already show all nodes at the first cut.

For each cluster, the server stores its members and representative node. It
checks that a collapsed branch is connected and has exactly one edge joining
it to the rest of the tree. Increasing detail reveals nodes within existing
branches without moving them between unrelated clusters.

See [LoD and clustering](./LOD_AND_CLUSTERING.md) for more detail.

## 7. Storing an unfinished version

The worker clears any previous data for the same layout version, then stores the
dataset and clusters with status `refining`.

A version marked `refining` is not selected as the latest readable version.
An earlier ready version with a different identifier can remain available while
the new version is prepared.

## 8. Edges for coarse views

For each LoD level, the server replaces each edge endpoint with its cluster's
representative. Edges inside a cluster disappear from that view. Edges between
clusters keep the distance of the original connecting edge.

This is tree contraction, also called a quotient graph. Contracting these
subtrees cannot create parallel edges. Each collapsed branch has one connection
to the rest of the tree, so it cannot become a shortcut between two visible
parts of the tree.

The server stores these edges in advance so viewport requests do not need to
rebuild the coarse graph.

## 9. Global layout

The server computes one position for each original node. A single-node dataset
is placed at the origin. Supplied node `x` and `y` values do not bypass this step.

### Graphviz `sfdp`

For components containing edges, PhyloLens sends Graphviz `sfdp` an undirected
DOT graph containing the nodes and their connections.

- Branch lengths and allelic distances are not supplied as preferred edge lengths.
- The global `K` setting controls approximate spacing for the graph as a whole.
- The default settings use `K=0.3`, Prism overlap removal, spring smoothing,
  and a normal quadtree. Other supported settings can be supplied in the request.
- Component packing is enabled. The configured overlap setting is passed to
  Graphviz for both connected trees and forests.
- PhyloLens does not set `maxiter` from the node count; Graphviz uses its own default.
- There is no default timeout. An operator can set a positive timeout with
  `PHYLO_LENS_GRAPHVIZ_SFDP_TIMEOUT_SECONDS`.

Graphviz's per-edge `len` attribute is supported by `neato` and `fdp`, rather
than `sfdp`. Adding it to the current DOT graph would not make biological
distances control edge lengths. See the [Graphviz documentation for `len`](https://graphviz.org/docs/attrs/len/).
The current layout cannot use biological distances as target edge lengths.
Adding this support is future work.

The server reads node positions from Graphviz's `plain` output and keeps those
coordinates without centering or rescaling them. It does not spread out a
one-dimensional or point-collapsed result.

Isolated nodes are handled separately because the spring smoother requires a
neighbour for each node. PhyloLens places isolates in a repeatable grid beside
the Graphviz layout without adding artificial edges. If all nodes are isolated,
the grid is used on its own and `sfdp` is not called.

### Layout failures

If `sfdp` is required but is missing, cannot start, exits with an error, times
out, or returns invalid or incomplete positions, preparation fails. The version
is not published. The job reports the reason and any available exit status,
timeout, or Graphviz error output. The server does not substitute a circular
layout after a Graphviz failure.

## 10. Node and cluster positions

The server stores one position per original node. A cluster uses the position
of its representative node, with bounds and a radius calculated from all its
members.

All LoD levels share the same coordinate system. The server does not lay out
each level separately, so expanding a branch reveals its nodes at their stored
global positions.

## 11. Storage

The worker stores:

1. the dataset, metadata, and isolate records;
2. clusters and their member nodes;
3. original tree edges;
4. global node positions;
5. cluster positions, bounds, and metadata summaries;
6. edges for each LoD level.

SQLite and PostgreSQL support the same preparation and query operations. Large
writes are split into batches and grouped into database transactions.

## 12. Making the layout available

After all preparation data has been stored, the worker marks the version `ready`.
Requests that omit `layout_version` can then select it as the latest ready
version.

The job returns counts, the number of LoD levels, layout status, and warnings.
Local jobs and PostgreSQL jobs use the same response format.

## 13. Preparation failures

A failed job records an error and leaves the unfinished layout unpublished.
Possible causes include:

- invalid Newick or typing data;
- a PhyloLib error or timeout;
- a Graphviz error, missing executable, or configured timeout;
- a database error;
- a PostgreSQL worker losing its job lease before publication.

PostgreSQL workers check that they still own the job between storage steps and
before publication. A worker that loses ownership stops before the next step.

## 14. Viewport, region, and search requests

Once a version is ready, interactive requests use the stored graph:

```text
viewport request
  → resolve the layout version
  → choose a prepared LoD level
  → find nodes or clusters within the view bounds
  → include required neighbours and matching edges
  → attach metadata
  → return the response
```

When the client supplies a target number of visible representations, the server
uses counts within the view bounds to choose a level of detail. A sparse view
can show more detail than the zoom preference alone would suggest. The previous
level helps avoid repeated switching near a density threshold. The target
selects a whole prepared level; it does not cut nodes out of that level.

Normal viewport requests have no node-count limit. An explicit `max_nodes`
limit can truncate the response. Region selection reads original nodes within
the requested box at full detail. Search matches identifiers and public
metadata, ranks the results, and returns stored positions for navigation.

## Measuring preparation time

Useful measurements separate:

- input parsing;
- PhyloLib distance calculation;
- goeBURST tree construction;
- dataset normalization;
- subtree and LoD construction;
- Graphviz layout;
- database storage;
- the first viewport read and response serialization.

Use a fresh process, or account for cached jobs and stored layouts. Reusing the
same `(dataset_id, layout_version)` measures reuse time rather than a new
preparation run.
