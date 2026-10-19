# Visualization meeting requirements — 2026-10-19

The repeated Linear/Logarithmic item is counted once. This checklist records
implementation and regression coverage for the eleven distinct requirements.

| Requirement | Delivered behavior | Coverage |
| --- | --- | --- |
| Nodes shrink on zoom-out | Glyph size shrinks with positional scale; zoom-in growth is bounded. | `glyphZoom.test.ts` |
| Linear and Logarithmic sizing | Fixed base radius plus value or `ln(1 + value)`, independent of viewport extrema. | `viewportSnapshot.test.ts`, `visualMappingControls.test.ts` |
| Expand/collapse on small trees without LoD aggregates | Internal nodes can hide and restore their technical-root descendants. Manual circles/rings and counts distinguish them from LoD triangles. | `viewportCoordinator.test.ts`, browser sequence |
| Reset palette | Reset restores default colors while retaining fields, sizing and grouping. | `visualMappingPalette.test.ts`, browser sequence |
| Old colors reappearing | Overrides are scoped to field combinations and cleared on new trees or successful ancillary replacement. Stale palette-file reads cannot undo Reset. | `visualMappingPalette.test.ts`, browser sequence |
| Branch dragging | An explicit arrangement root selects loaded descendants for coherent translation, preserving topology and distance values. | `sigmaDragController.test.ts`, browser pointer sequence |
| Clusters use hop counts | Membership uses tree hops, independently of branch distances. | `test_prepared_layout.py`, `test_lod_selection.py` |
| Small components within forests | Components of one to three canonical nodes stay explicit at all prepared tiers; components retain separate roots and connectivity. | `test_prepared_layout.py`, `test_isolated_layout.py` |
| Distance-label interval | Optional inclusive minimum/maximum bounds affect labels, including export, without hiding edges. | `edgePresentation.test.ts`, browser sequence |
| Distance-weighted grayscale edges | Fixed grayscale encoding replaces thickness growth; edge widths and numeric distances remain unchanged. | `edgePresentation.test.ts`, `sigmaRenderer.test.ts`, browser sequence |
| Review Select Node | Removed the redundant node dropdown and wheel scope. Canvas clicks and Search populate the selected-node panel. | `uiShell.test.ts`, browser sequence |

Manual folding requires a complete canonical view: small trees load that view
initially, and other trees can use Expand all. Partial branches are never guessed.
New loads clear manual folds; pan, zoom, ancillary replacement and nested
collapse/expand preserve the loaded topology. A folded node retains its own
observations; its hidden descendants are not reinterpreted as isolates of that node.

Validation: 323 client tests passed, including browser-fixture type checks;
320 server tests passed, with two database-dependent checks skipped. Client
lint, formatting, demo/library builds, server lint/formatting, and the browser
sequence against the real API passed. See
[`meetingRequirements.mjs`](../../code/client/tests/browser/meetingRequirements.mjs)
and [browser test instructions](../../code/client/tests/README.md).

The changed forest-cut policy has a new layout fingerprint, so cached layouts
must be prepared again to obtain the protected small-component representation.
