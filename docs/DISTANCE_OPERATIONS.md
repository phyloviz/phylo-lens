# Distance operations: decisions and implementation

User-facing steps and meanings are in the [user guide](USER_GUIDE.md).

## Topology and interpretation

The cutoff keeps canonical tree edges with distance **≤ cutoff** before layout,
forest indexing and LoD. Every node remains. A severed child's original direction
defines its new component root. This linear traversal avoids searching the tree
again for each cut. Applying it through Load makes layout reconstruction and the
loss of prior manual arrangements explicit. Blank disables the cutoff; zero is
a real value. Unknown weights are rejected instead of becoming zero.

Additional connections are a separate overlay. They use allelic Hamming distance
on the globally retained loci for typing input, and canonical decimal branch-path
sums for Newick. IDs and equivalent-profile grouping match ingestion. Newick
endpoints are explicitly named nodes, including named internal nodes. Generated
junctions remain structural. Equal thresholds and distinct zero-distance pairs
are included. Self-links and duplicate tree links are excluded.

An overlay must not undo the cutoff. The service obtains node ownership and
tree edges for the exact published layout version, then restricts connections to
those components. The browser also checks component ownership when composing
the visible slice. Group representatives have no single exact pairwise distance;
links with grouped or manually hidden endpoints are omitted. The complete query
count and visible count are reported separately.

The overlay never enters forest indexing, LoD construction or branch membership.
Force-layout springs and branch dragging explicitly ignore overlay edges. It
can contain cycles without changing the tree operations. The PNG caption records
the metric and threshold so exported views retain their interpretation.

## Data and cost

The browser owns the load's input string for its session and sends it only on an
explicit Apply. Newick distances use persisted tree weights; typing requests
normalize the original profile input using the preparation policy. The endpoint
verifies canonical node identities against the layout. API callers must supply
the same typing input used to prepare that layout; node-ID equality alone does
not authenticate allele values.

Patristic queries build an iterative centroid decomposition with sorted radius
buckets. A pair is emitted at its separating centroid, where the stored lengths
sum to its exact tree path. Index storage is O(N log N), construction is
O(N log² N) with per-bucket sorting, and candidate enumeration is output-sensitive
with logarithmic overhead. Deep chains do not consume the Python call stack.
Decimal accumulation avoids losing a threshold such as 0.3 to the binary sum of
0.1 and 0.2. Values start from the service's canonical edge weights.

Allelic queries partition loci into n+1 blocks: a pair with at most n differences
must share a block. Candidates are verified by exact categorical Hamming counts,
with early exit above the threshold. Only one source's candidate set is held at
a time. Adversarial data or high thresholds can still require O(P²L) work for
P profiles and L retained loci; this is not a subquadratic guarantee. Neither
algorithm stores a complete quadratic distance matrix.

The caller's positive connection limit defaults to 50,000. Exceeding it rejects
the whole new result. It bounds output, not worst-case computation time. The
previous overlay remains until a complete replacement arrives. Superseded reads
are aborted in the browser, and generation/layout checks reject late results.
The service does not promise cancellation of computation already executing.

On receipt, the browser indexes overlay edges by source once. Camera refreshes
visit only loaded sources' links. Overlays are session state, cleared on a new
load, and are not written into prepared tree tables. Existing layouts need no
database migration. Layouts without a forest index must be prepared again.

## Validation scope

Tests use independent small-tree traversals and full Hamming comparisons as
oracles, exercise a 6,000-node chain, and query a real layout repository through
HTTP. Browser regressions cover cutoff restoration, exact path links, rejected
partial results, folds, responsive controls and PNG captions. Unit checks protect
stale ownership, tree-only springs and branch membership in a cyclic overlay.
Human usability observations remain separate.
