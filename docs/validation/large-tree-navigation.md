# Large-tree navigation validation

Issue: #13. Recorded 2026-09-17 on Apple M4 Pro, 24 GiB RAM, Chromium 152.0.0.0 (Codex browser), local Vite and Python API.

## Confirmed causes and changes

- Recreating Sigma for display options discarded the global bounding box. Camera coordinates then referred to the loaded slice instead of the whole tree. Labels now update settings in place; pie-program rebuilds restore the bounding box before restoring the camera.
- An in-flight viewport could commit after the camera changed but before the debounce timer started the next request. Scheduling now invalidates the previous request immediately.
- Initial fitting created an untracked second timer. Fits now have a cancellation function covering delayed stages and active motion. Pointer, wheel and touch input, renderer replacement, disposal and ancillary replacement cancel owned fits. The initial fit targets the graph directly instead of resetting and subsequently adjusting the current camera.
- Camera changes during a settling fit were discarded. The final change is now scheduled for after the settling period.
- A viewport replacement retained expansion caches for members no longer displayed. Those caches now expire with their snapshot, allowing a returning representative to expand again.

## Browser regression

Start the normal API and demo, then open `/navigation-regression.html` on the demo server. This development-only page imports the real Sigma adapter and viewport controller; it does not add diagnostics to the published API.

**Run navigation regression** tests a deterministic 10,000-node tree and 1,000-node slices. It uses 1000×400 and 400×1000 containers, zooms into a subset, pans to the center and beyond the original bounds, replaces snapshots, and toggles labels off/on/off. It checks camera ratio, graph-space viewport drift, aspect ratio and center. A pointer interruption checks that a pending fit cannot move the camera later.

Before the fix, all 12 original snapshot/toggle cases failed: the viewport shifted by up to 873.53 graph units. After the fix all pass, with zero drift; center conversion error is below 0.000104 graph units. Snapshot/toggle plus two animation frames took 16.5–17.5 ms in the recorded run. These are local observations, not benchmark guarantees. See [raw canvas results](large-tree-navigation-canvas.json).

**Run Newick navigation** accepts a file and uses the real server preparation and viewport endpoints. It loads a coarse tier, expands and collapses a representative, fits a subset, pans beyond global bounds, retrieves that viewport and toggles labels. The sequence repeats with labels enabled. Use a tree above 6,000 nodes to exercise production semantic zoom.

The large fixture was generated with the existing evaluation generator:

```sh
PYTHONPATH=eval/src .venv/bin/python - <<'PY'
from pathlib import Path
from phylo_lens_eval.pilots.rq4 import deterministic_newick
Path('/tmp/navigation-6001-leaves.nwk').write_text(deterministic_newick(6001))
PY
```

This produces 12,001 nodes, 12,000 edges and two LoD tiers. Both label states passed; expansion displayed 1,514 nodes and took 20.6–21.1 ms including the harness polling interval. Camera state was unchanged through expansion, collapse and toggles. The 130.5 ms preparation request reused the prepared layout and must not be interpreted as a cold layout benchmark. See [raw Newick results](large-tree-navigation-newick.json).

The repository's `phyloviz-spneumoniae.nwk` was also loaded in the normal demo: 379 nodes, 378 edges, tier 8/8, and distance labels enabled. It is below the production threshold for viewport slicing, so it cannot replace the generated large-tree regression. The original researcher gesture sequence and hardware are not available; the deterministic sequence above covers the confirmed causes rather than claiming to reproduce every reported gesture.

## Automated checks and API impact

Client unit tests cover global coordinates across label toggles and pie rebuilds, stale replies during debounce, final camera queries after interrupted fits, expansion after snapshot replacement, and cancellation before/during initial fitting. Run `npm test`, `npm run lint`, `npm run build`, `npm run build:lib`, and `npx tsc -p tests/browser/tsconfig.json` in `code/client`.

For custom implementations of the advanced `GraphRenderer` interface, `fitGraphSnapshot` now returns `(() => void) | null` rather than a timeout ID. The callback must cancel pending and active fitting. The public `createPhyloLensView` facade is unchanged.

Separate interaction commands, persistent explicit expansion and expand-all remain in #14. This change does not alter the edge-label zoom threshold or publication export controls (#17).
