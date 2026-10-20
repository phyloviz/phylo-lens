# Visualization meeting requirements — 2026-10-19

The repeated Linear/Logarithmic item is counted once. This checklist records
implementation and regression coverage for the eleven distinct requirements.
All eleven are covered. The scope review on 2026-10-20 confirmed that the existing
branch-dragging interaction and SFDP component packing satisfy their respective
meeting items, together with the configurable small-component protection below.

| Requirement | Delivered behavior | Coverage |
| --- | --- | --- |
| Nodes shrink on zoom-out | Glyph size shrinks with positional scale; zoom-in growth is bounded. | `glyphZoom.test.ts` |
| Linear and Logarithmic sizing | Fixed base radius plus value or `ln(1 + value)`, independent of viewport extrema. | `viewportSnapshot.test.ts`, `visualMappingControls.test.ts` |
| Expand/collapse on small trees without LoD aggregates | Internal nodes can hide and restore their technical-root descendants. Manual circles/rings and counts distinguish them from LoD triangles. | `viewportCoordinator.test.ts`, browser sequence |
| Reset palette | Reset restores default colors while retaining fields, sizing and grouping. | `visualMappingPalette.test.ts`, browser sequence |
| Old colors reappearing | Overrides are scoped to field combinations and cleared on new trees or successful ancillary replacement. Stale palette-file reads cannot undo Reset. | `visualMappingPalette.test.ts`, browser sequence |
| Branch dragging | The existing interaction uses an explicit arrangement root to select loaded descendants for coherent translation, preserving topology and distance values. | `sigmaDragController.test.ts`, browser pointer sequence |
| Clusters use hop counts | Membership uses tree hops, independently of branch distances. | `test_prepared_layout.py`, `test_lod_selection.py` |
| Small components within forests | Existing SFDP component packing organizes disconnected trees. A configurable per-component limit (default 64, zero disables) keeps small components explicit at all tiers; roots and connectivity remain separate. | `test_prepared_layout.py`, `test_isolated_layout.py` |
| Distance-label interval | Optional inclusive minimum/maximum bounds affect labels, including export, without hiding edges. | `edgePresentation.test.ts`, browser sequence |
| Distance-weighted grayscale edges | Fixed grayscale encoding replaces thickness growth; edge widths and numeric distances remain unchanged. | `edgePresentation.test.ts`, `sigmaRenderer.test.ts`, browser sequence |
| Review Select Node | Removed the redundant node dropdown and wheel scope. Canvas clicks and Search populate the selected-node panel. | `uiShell.test.ts`, browser sequence |

Manual folding uses canonical DFS intervals carried by viewport nodes. It works
on partial slices and preserves intentions across automatic LoD, pan, zoom,
filters and ancillary replacement. Nested folds remain recorded; search reveals
hidden targets; a new load or Expand all clears intentions. Markers retain their
own observations. Branch commands take node IDs; LoD group commands take cluster
IDs, which can be shared by expanded members.

Validation includes operation-count tests on a 20,000-node chain and 10,000
component roots, partial-slice and nested-fold tests, coarse/fine viewport
transitions, and real-API browser controls, including a 4,095-node partial LoD
view. Reproducible measurements and their limits are in [Indexed branch operations](../TREE_INDEX.md).
See [`meetingRequirements.mjs`](../../code/client/tests/browser/meetingRequirements.mjs)
and [browser test instructions](../../code/client/tests/README.md).

The changed forest-cut policy has a new layout fingerprint, so cached layouts
must be prepared again to obtain the protected small-component representation.

PostgreSQL deployments must run the existing schema initializer before starting
the revised service. Existing layouts remain readable, but must be prepared again
to obtain subtree indices and the revised component policy.

Validation for this revision: 334 client tests and 336 server tests pass; two
database-dependent checks are skipped. Client type checks, lint, formatting and
demo/library builds pass, as do server lint/formatting and the real-API browser
sequence.

The evaluation suite also passes locally with smoke flags enabled: 138 tests,
with five environment-dependent skips. Its independent BFS oracle covers both
protected components and disabled protection; corruption checks include every
materialized quotient tier, even when finest-tier reads use canonical edges.
