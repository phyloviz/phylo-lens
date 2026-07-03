# Backlog — Tuning & Scalability Follow-ups

Tracked items surfaced by the `task/gf/full_code_reorganization` audit. These are
**tuning / optimization judgment calls**, not correctness bugs — the branch is
green (server 57 passed, client 107 passed, `tsc` clean) without them.

Each item is deferred deliberately because changing it trades off behavior that
needs a product/perf decision, not a mechanical fix.

---

## 1. Debounce / suppression tuning (perceived LoD responsiveness)

**Area:** client viewport refresh timing.

**Evidence:**
- `code/client/src/render/adapters/sigma/graphViewerV2Query.ts:8`
  — `DEFAULT_GRAPH_VIEWER_V2_DEBOUNCE_MS = 250` (delay after a pan/zoom within
  the same LoD level before a server viewport query fires).
- `code/client/src/render/adapters/sigma/sigmaDragController.ts:122,148,181`
  — `suppressViewChangesFor(250)` at drag start / move / end.
- `code/client/src/render/adapters/sigma/sigmaRenderer.ts:185`
  — `suppressViewChangesFor(450)` on node-focus centering.

**Observed effect:** worst case, a drag-release-then-pan sequence stacks a 250ms
suppression + 250ms debounce ≈ 500ms before the viewport refreshes. Feels
"clunky" even though nothing is wrong.

**Ruled out:** the 4s ForceAtlas2 motion is **not** involved — it is gated by
`isForceMotionLayout()` (`sigmaForceMotion.ts:100`), which requires
`viewMeta.layout === "force"`. The LoD path sets `layout: "server"`
(`graphWorkbench.ts:367`), so force motion never runs during semantic zoom.

**Suggested fix (needs decision):** lower the debounce (e.g. 250 → 120ms) and/or
skip the drag-end suppression when the pointer is released, then measure whether
extra mid-gesture server queries are acceptable.

---

## 2. sfdp layout timeout risk on large trees (~12k+ nodes)

**Area:** server global layout.

**Evidence:**
- `code/server/src/phylo_lens_server/prepared_layout/layout.py:25`
  — `GRAPHVIZ_LAYOUT_TIMEOUT_SECONDS = 15`.
- `code/server/src/phylo_lens_server/prepared_layout/layout.py:128`
  — timeout applied to the `sfdp` subprocess; on expiry the layout degrades to a
  circular fallback (`jittered_positions`).
- `code/server/src/phylo_lens_server/prepared_layout/layout.py:159`
  — `maxiter=100`.

**Observed risk:** for ~12k nodes / ~24k edges, sfdp can run 8–20s; the 15s
ceiling may trip on dense/balanced trees, silently dropping the real layout to
the circular fallback (the old "dome").

**Suggested fix (needs decision):** make `maxiter` node-count-aware
(e.g. `max(50, 200 - N // 100)`), and/or raise the timeout, and/or pre-cluster
before sfdp for N above a threshold. Requires benchmarking on a real large tree.

---

## 3. Per-threshold edge re-sort in clustering (`ingest.py`)

**Area:** server clustering cost.

**Evidence:**
- `code/server/src/phylo_lens_server/prepared_layout/ingest.py:18`
  — `MAX_CLUSTER_THRESHOLDS = 16`.
- `code/server/src/phylo_lens_server/prepared_layout/ingest.py:189`
  — `threshold_component_counts()` sorts edges once by `(distance, source, target)`.
- `code/server/src/phylo_lens_server/prepared_layout/ingest.py:240`
  — `distance_clusters()` sorts edges again.
- `partition_for_threshold()` re-sorts the full edge list **per selected
  threshold** — up to 16 independent `O(E log E)` sorts on the same edges.

**Observed cost:** ~18 × `E log E` for 24k edges ≈ 6M+ operations, redundant
because every sort uses effectively the same distance ordering.

**Suggested fix (needs decision):** sort the edge list once (by distance) and
pass the sorted slice into `partition_for_threshold()` instead of re-sorting per
threshold. Pure optimization — must preserve the existing `<=` threshold
semantics and tiebreak ordering exactly (verify against `test_prepared_layout.py`).

---

## Not in this list (already resolved on the branch)

- **Filter-logic duplication** — `nodePassesFilters` in `graphViewerV2Sync.ts`
  removed; both paths now use the single `matchesFilterState` in
  `ancillary/filterEngine.ts`.
- **Metadata / visual mappings / pies / filtering under LoD** — confirmed wired
  and green.
- **The "dome"** — fixed at the pipeline level (sfdp installed, stale store
  cleared, topology-aware layout).
