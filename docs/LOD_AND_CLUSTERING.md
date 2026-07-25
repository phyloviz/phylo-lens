# Level of detail and distance clustering

PhyloLens uses a server-prepared level-of-detail (LoD) hierarchy to reduce the
number of graph elements returned and rendered at broad views. The hierarchy is
based on canonical edge distances and remains aligned to one global layout.

LoD is a display and query mechanism. It does not alter the canonical topology or
claim a new biological grouping model beyond the supplied distances.

## Terminology

- **canonical node** — a node in the normalized input graph;
- **distance threshold** — maximum edge distance admitted when computing
  connected components;
- **prepared cluster** — one connected component at one selected threshold;
- **representative** — one canonical member used to display a prepared cluster;
- **LoD level** — client/server index that selects a prepared threshold or the
  finest-detail node table;
- **quotient edge** — an edge between representatives at a coarse tier;
- **cluster expansion** — an explicit request for all members of one cluster.

## Threshold clustering

For a threshold `t`, PhyloLens considers canonical edges with:

```text
edge.distance <= t
```

Connected components of that subgraph form the partition for `t`.

With thresholds ordered from high to low:

- a high threshold generally produces fewer, larger components;
- a lower threshold produces more, smaller components;
- the minimum selected threshold resolves to finest detail.

The graph may be disconnected. Components from separate trees or goeBURST
components remain independent at every threshold.

## Threshold selection

The pipeline selects at most 16 thresholds. It does not choose evenly spaced
numeric distances because edge-distance distributions are often highly skewed.
Instead, it targets a progressive number of representatives.

The broadest target is derived from graph size:

- for graphs up to 300 nodes, approximately `7 × sqrt(node_count)`, capped by
  the node count;
- for larger graphs, the target is bounded between 300 and 800 representatives.

Subsequent targets grow toward the canonical node count. Growth uses the smaller
of:

- a geometric progression toward the full graph;
- a maximum factor of 2.5 over the previous target.

For each target, the selected distance is the threshold whose component count is
closest without falling below the target when possible. Duplicate thresholds are
removed. The minimum edge distance is always included as the finest selected
threshold.

This policy adapts the number of tiers to topology and distance distribution. A
dataset with few unique distances may expose fewer tiers.

## Deterministic cluster identity

A prepared cluster identifier includes:

- the distance threshold;
- the first sorted member identifier;
- a short SHA-1 digest of the sorted member identifiers.

Cluster identity is deterministic for the same canonical graph and threshold.
It is internal to one prepared layout and should not be used as an external
biological identifier.

## Representative selection

The representative is always a canonical member of the cluster.

When canonical nodes carry coordinates, PhyloLens selects the member closest to
the member centroid. Ties prefer higher internal degree, then identifier order.

When coordinates are absent during cluster preparation, selection prefers:

1. highest internal degree within the cluster;
2. lexicographically smallest node identifier.

Graphviz positions are computed later. Therefore, in the normal Newick and
typing-data path, the representative is an internally well-connected member, not
the node nearest the final `sfdp` centroid.

## Cluster records

Each prepared cluster stores:

- members;
- representative;
- internal original edges;
- boundary original edges;
- threshold;
- member count;
- representative position;
- member-derived bounds and radius;
- aggregated public metadata.

Internal and boundary edge lists support explicit expansion and connectivity
preservation.

## Quotient graph per tier

For each coarse tier, canonical edge endpoints are mapped to representatives.

- edges whose endpoints map to the same representative are internal and omitted;
- edges between different representatives become prepared quotient edges;
- duplicate representative pairs are collapsed deterministically;
- the minimum available canonical distance is retained for each pair.

The quotient graph is materialized during preparation. Viewport reads do not
recompute cluster connectivity.

## Server LoD level semantics

The store loads distinct non-null thresholds in descending order. A requested
`lod_level` is clamped to that list.

The minimum threshold is treated as finest detail and maps to the
`node_positions` table rather than cluster representatives. Consequently:

```text
lod_level 0            → broadest available prepared tier
intermediate levels    → progressively finer representative tiers
last available level   → individual canonical nodes
```

When the graph has no meaningful coarse threshold, reads fall back to individual
nodes.

A request without `lod_level` uses server compatibility behavior:

- `zoom < 1` selects LoD level `0`;
- otherwise it reads finest detail.

The browser library normally sends an explicit LoD level.

## Browser semantic zoom

The browser maps Sigma camera ratio to a LoD level. A larger camera ratio means
a broader view; a smaller ratio means a closer view.

Current defaults:

| Setting | Value | Meaning |
| --- | ---: | --- |
| Broad-detail boundary | `0.8` | Ratios at or above this value use level `0` |
| Standard tier ratio step | `0.4` | Boundary multiplier when fewer than 8 tiers exist |
| Dense tier ratio step | `2/3` | Boundary multiplier when 8 or more tiers exist |
| Tier-change hysteresis | `0.05` | Dead band around a boundary |
| Camera debounce | `120 ms` | Standard viewport refresh delay |
| LoD-change debounce | `60 ms` | Faster refresh when the semantic tier changes |

Hysteresis prevents rapid alternation between adjacent levels near a zoom
boundary.

## Small-graph behavior

The browser treats a prepared graph with at most 6,000 canonical nodes as small.
It requests the finest tier and, once loaded, suppresses camera-driven viewport
refreshes. This avoids unnecessary server queries when the complete graph fits
within the intended renderer budget.

The public browser load path defaults to a viewport budget of 6,000 nodes, while
the server HTTP default is 2,500 and the hard maximum is 20,000. The client may request a different
budget through the public load options.

The service can include neighbour nodes required to preserve edge endpoints, so
the response node count can exceed the number selected directly by the viewport
bounds.

## Viewport bounds

For non-global coarse or intermediate reads, the client expands the camera bounds
by 50% in each direction before querying. The padded region reduces visible
loading at the screen edge during small camera movements.

The initial broad request omits bounds. Finest-tier requests for known small
graphs also omit bounds.

## Metadata at different levels

Finest-detail nodes receive their public node metadata.

Cluster representatives receive aggregated metadata:

- numeric fields: mean of non-null member values;
- categorical and boolean fields: mode with deterministic tie-breaking;
- internal category counts remain available to the visual-mapping layer but are
  not exposed as public metadata fields.

A representative is therefore a visual summary of a set of members, not an
ordinary sample record.

## Truncation

Every viewport request has `max_nodes`. The response reports:

- `total_node_count`, the number of directly eligible nodes or representatives;
- `truncated`, whether the direct selection exceeded the budget.

Truncation is observable and should not be interpreted as a complete graph view.
Host applications may adjust the budget, change zoom, or use explicit cluster
expansion.

## Explicit cluster expansion

A viewport query with `cluster_id` bypasses normal tier selection and returns:

- all cluster members at finest detail;
- internal canonical edges;
- neighbouring representatives needed for external connectivity;
- server-generated meta-edges for bundled boundary connections.

Expansion is described in [Cluster interaction](./EXPAND_COLLAPSE.md).

## Evaluation considerations

LoD evaluation should distinguish:

- preparation cost of materializing thresholds and quotient edges;
- response size per tier;
- visible node and edge counts;
- viewport query latency;
- client snapshot-application latency;
- stability around tier boundaries;
- topology and metadata preserved by representative aggregation.

The threshold policy is deterministic but heuristic. Its effectiveness should be
supported by experimental results rather than described as optimal.
