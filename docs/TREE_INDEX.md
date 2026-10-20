# Indexed branch operations

The design separates immutable topology, automatic LoD and manual view intent.
A typed topology value crosses the API boundary; an interval module owns fold
intentions and their cached cover. The viewport coordinator only composes these
operations. This applies information hiding and separates policy from mechanism.
The data structure serves subtree visibility queries; no subtree-rank queries or
range-update counts currently require a segment tree.

## Invariants and behavior

Preparation runs iterative depth-first search from each technical root. A node's
subtree occupies `[start, end)` in global preorder. Its canonical size is
`end - start`, so the hidden-descendant count is available without enumeration.
Intervals in one forest are nested or disjoint; components have disjoint ranges.
The index rejects cycles, repeated roots and incomplete component coverage. Deep
chains use an explicit stack instead of Python recursion.

SQL stores the index once per immutable layout version in `node_tree_index`,
keyed by dataset, version and canonical node ID. Reads attach only the entries for
returned representations. Ancillary replacement copies those entries with the
geometry; changing preparation policy creates a different layout fingerprint.
Older layouts have no entries, so ordinary-node folding is unavailable until
repreparation. Their LoD groups remain usable.

Manual state is a map keyed by canonical node ID. On an intent change, sort the
intervals and cache their disjoint outer cover. Retain nested intentions in the
map, so expanding an outer fold reveals earlier nested folds. Each streamed
representation uses binary search in the cover; remove edges whose endpoints
were hidden. A coarser aggregate that contains a fold remains an ordinary LoD
triangle until refinement reveals that fold again. Presentation filters do not
cancel structural hiding.

Separate `collapseBranch`/`expandBranch` commands take node IDs. Group commands
take cluster IDs; one expanded group's members can share a cluster ID. The
client validates index fields as safe integers and owns the mapped response data.

## Costs

Let N/E describe the canonical forest, K/A the returned nodes/edges, F recorded
fold intentions and R component roots. These bounds describe the added index
and manual-fold operations, not force layout or all existing LoD preparation.

| Operation | Time | Additional space |
| --- | --- | --- |
| Build the index from adjacency | O(N + E) | O(N) |
| Subtree containment or canonical size | O(1) | O(1) |
| Add/remove one intention and rebuild cover | O(F log F) | O(F) |
| Apply folds to a viewport | O(K log(F + 2) + A) | O(K + A + F) |
| Reveal a search target | O(F) scan, plus cover rebuild if changed | O(F) |
| Batch component-root intentions | O(K + R log R) | O(R) |

Collapse all batches roots in one pass and rebuilds once. It never searches the
node array separately for each root. Applying nested folds does not enumerate
descendants for each intention. Repeated single-node edits still rebuild the
cover each time; an ordered balanced structure would only be justified if
measurements show those edits to be a bottleneck. Expanding all remains a
potentially large global operation, bounded only by an explicit node budget.

## Reproducible measurements

Local microbenchmarks on 2026-10-19, Python 3.13.5 / Node 24.12.0. Python reports
five-run medians; client measurements warm up once then use ten runs. They
exclude network, database I/O, force layout and GPU rendering. They are not CI
latency limits or end-to-end performance claims.

| Canonical nodes | Chain index (ms) | Star index (ms) | 64-node component forest index (ms) |
| --- | --- | --- | --- |
| 10,000 | 6.97 | 7.39 | 7.25 |
| 50,000 | 39.40 | 39.93 | 40.89 |
| 100,000 | 80.83 | 92.35 | 94.11 |

| Streamed nodes | Folded component roots | Batch intentions (ms) | Apply (ms) |
| --- | --- | --- | --- |
| 10,000 | 1,000 | 0.18 | 0.68 |
| 50,000 | 5,000 | 0.83 | 3.89 |
| 100,000 | 10,000 | 0.91 | 8.76 |

The client fixture has ten nodes per component and folds each root. Its intent
intervals arrive ordered; JavaScript sorting benefits from that input. Correctness
tests separately exercise nested folds and unordered/disjoint intervals. A
20,000-node chain test counts exactly two adjacency visits per edge; a 10,000-root
test confirms one scan when collecting root intentions.

For the small-component default, a synthetic 10,400-node forest repeats component
sizes 16, 48, 96 and 256. Limits 32, 64 and 128 produced respectively 550, 1,700
and 4,050 coarsest representations. This demonstrates the density tradeoff; it
does not establish a readability optimum. The default of 64 keeps moderately
small components explicit while allowing larger components to aggregate. Hosts
can change it or disable protection with zero. A forest with many protected
components can still be dense; viewport bounds and detail selection still apply.

Run from `code/server`:

```sh
.venv/bin/python scripts/benchmark_tree_index.py
```

Run from `code/client`:

```sh
node tests/benchmarkManualBranches.mjs
```
