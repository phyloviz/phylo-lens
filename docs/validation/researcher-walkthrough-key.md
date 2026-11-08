# Researcher walkthrough — facilitator key

Keep this separate from the initial participant prompts. These are fixture facts
and current implementation semantics, not results from a human evaluation.

## Public tree

The [core input](../../examples/newick/phyloviz-spneumoniae.nwk) has 379 canonical
nodes, 378 edges and one component. With default preparation on the current
local build, its generated root is `union_1` and it has eight detail tiers.
Verify these after any parser, preparation or configuration change.

The setup in the [protocol](researcher-walkthrough.md) was exercised in a local
browser dry run on 7 November 2026:

- Initial finest view: 379 drawn symbols, 378 edges.
- **Collapse all**: one violet manual-fold marker, representing 379 nodes
  (root plus 378 hidden descendants).
- Select that marker directly and **Expand branch**: a coarse view with three
  symbols and two edges. The amber groups represent **341** and **37** nodes,
  plus the ordinary root representing one node: 341 + 37 + 1 = 379.

The two triangle sizes do not have the same ratio as 341:37. Size is a bounded,
compressed indication of node count. Exact counts come from hover or selection.
The 6–12 mapping range is in renderer size units, not a guaranteed screen-pixel
range at every camera zoom. Large counts approach the cap and may look similar.

This raw Newick input does not supply biological isolate totals. **Unavailable
does not mean zero**, and 379 tree nodes is not evidence of 379 isolates.

## Operations and count scope

- An amber triangle is an automatic LoD representative. **Expand group** reveals
  that group; selecting one of its expanded members offers **Collapse group**.
  This restores the automatic representative rather than creating a manual fold.
- A violet triangle is a deliberately folded descendant branch. Its node count
  includes the retained root and hidden descendants. **Expand branch** removes
  that manual fold; the current detail tier can still contain automatic groups.
- Manual folds retain only the root node's isolate IDs, ancillary values and pie
  data. The whole-branch isolate total is unavailable in this view. Root data must
  not be reported as the total or distribution of the full folded branch.
- “Symbols drawn” counts visible marks, including representatives. It differs
  from the number of canonical nodes those marks represent.
- Automatic detail changes should preserve the requested camera. User zoom/pan,
  search focusing, fitting and explicit navigation can intentionally move it.
  With motion paused, surviving arranged nodes should retain their positions.
- Publication PNGs with the legend enabled explain the triangle kinds present,
  compressed node sizes and root-only ancillary scope when applicable. This
  caption is not a full dataset/provenance record.

## Optional typing case

The [typing fixture](../../examples/typing/missing-loci.tsv) contains four isolate
IDs but three distinct retained profiles. `iso-A` and `iso-B` share one profile;
`iso-C` and `iso-D` each form another. Thus the prepared tree has **3 profile
nodes, 2 edges and 4 isolates**. Inspect the shared profile to find its two
original IDs. The [expected profile groups and distances](../../examples/typing/missing-loci.expected.json)
provide an independent, hand-checkable fixture reference.

| Input | SHA-256 |
| --- | --- |
| Typing table | `f4ffd527c5118deccd59ff9e10b284cba5df7f33f77abebf17f09eb923805408` |
| Ancillary table | `5500eddce4dd32a645f3a9856e2753c560fc12ffbaf4c119f36947874b7041fd` |

## Debrief boundaries

Correct answers after a hint are assisted completions. A facilitator dry run is
not an unassisted researcher result. A few successful sessions would support
describing those observations, not claiming universal comprehension or an
optimal size formula. Preserve failures and disagreements in the record.
