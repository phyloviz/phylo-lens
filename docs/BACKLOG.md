# Backlog — Tuning & Scalability Follow-ups

Tracked items surfaced by the `task/gf/full_code_reorganization` audit. These are
**tuning / optimization judgment calls**, not correctness bugs — the branch is
green (server 57 passed, client 107 passed, `tsc` clean) without them.

Each item is deferred deliberately because changing it trades off behavior that
needs a product/perf decision, not a mechanical fix.

---

## 1. Debounce / suppression tuning (perceived LoD responsiveness) — RESOLVED

**Area:** client viewport refresh timing.

**Resolution:** lowered `DEFAULT_GRAPH_VIEWER_V2_DEBOUNCE_MS` from 250 → 120ms
(`graphViewerV2Query.ts:8`) for snappier same-level panning. This is the only
genuine perf knob: LoD-level changes already bypass the debounce and refresh
immediately (`GraphViewerV2.ts:183`, `scheduleViewportRefresh(lodChanged ? 0 : …)`),
so zoom-across-threshold was never delayed.

**Left unchanged (correctness guards, not perf padding):**
- `sigmaDragController.ts:122,148,181` — `suppressViewChangesFor(250)` at drag
  start/move/end. These stop a node-drag from being misread as a viewport pan
  (which would fire a spurious server query). `suppressViewChangesFor` gates
  `emitViewChange` (`sigmaRenderer.ts:481`).
- `sigmaRenderer.ts:185` — `suppressViewChangesFor(450)` covers the programmatic
  camera animation on node-focus centering; dropping it would let the recenter
  emit a stray query and jump.

**Ruled out earlier:** the 4s ForceAtlas2 motion is **not** involved — gated by
`isForceMotionLayout()` (`sigmaForceMotion.ts:100`); the LoD path uses
`layout: "server"`, so force motion never runs during semantic zoom.

---

## 2. sfdp layout timeout risk on large trees (~12k+ nodes) — RESOLVED

**Area:** server global layout.

**Resolution:** `sfdp` confirmed as the right multilevel choice for 12k+ nodes
(O(V log V)); the subprocess boundary, not the algorithm, was the liability.
Hardened in `layout.py`:
- `maxiter` is now node-count-aware (`sfdp_maxiter`), scaling down for larger
  graphs so wall time stays bounded.
- Timeout is now node-count-aware (`sfdp_timeout_seconds`), scaling up to a
  `GRAPHVIZ_MAX_TIMEOUT_SECONDS` ceiling instead of a flat 15s.
- The degrade is no longer silent: `compute_global_node_positions` returns a
  reason (`sfdp_missing` / `sfdp_timeout` / `sfdp_failed` / `sfdp_incomplete`)
  threaded through `PreparedLayoutResult.layout_degraded_reason` to a truthful
  client warning in `api/v2_graph.py`.
- Separately, the additive `2.5 + distance` edge length (which crushed branch
  ratios) was replaced with ratio-preserving multiplicative scaling normalized
  by the per-graph median distance, clamped to bound outliers.

**Follow-up (still open, needs decision):** pre-cluster before sfdp for N above
a threshold as a further scalability lever. Requires benchmarking on a real
large tree to pick the threshold.

---

## 3. Per-threshold edge re-sort in clustering (`ingest.py`) — RESOLVED

**Area:** server clustering cost.

**Resolution:** the full edge list is now sorted once via `sort_edges_by_distance`
(preserving the original `(distance, id)` tiebreak) and threaded into
`partition_for_threshold()` through a new optional `sorted_edges` keyword. The
`prepare_layout_artifacts` loop hoists that sort above the per-threshold loop, so
the up-to-16 redundant `O(E log E)` sorts collapse to one.

**Correctness preserved:** connected components are independent of union order, so
the pre-sorted path is provably equivalent — verified byte-for-byte against the
original per-threshold-sort path across branching and 200-node chain datasets over
every selected threshold plus distance-spanning probes. The `<=` threshold filter
and `partition_for_threshold`'s public signature are unchanged (default still
sorts internally when no `sorted_edges` is supplied, keeping the direct test call
in `test_prepared_layout.py` intact). Server suite: 57 passed.

**Note:** `threshold_component_counts()` and `distance_clusters()` each still sort
once internally (a different `(distance, source, target)` tiebreak feeds their
component-count/cluster-key logic). Those single sorts are not redundant and were
left as-is; only the per-threshold repetition was the waste.

---

## Not in this list (already resolved on the branch)

- **Filter-logic duplication** — `nodePassesFilters` in `graphViewerV2Sync.ts`
  removed; both paths now use the single `matchesFilterState` in
  `ancillary/filterEngine.ts`.
- **Metadata / visual mappings / pies / filtering under LoD** — confirmed wired
  and green.
- **The "dome"** — fixed at the pipeline level (sfdp installed, stale store
  cleared, topology-aware layout).
