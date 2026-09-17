# Cluster expansion and collapse

Click selects a node. Double-click and the mouse wheel zoom; neither invokes an
expansion command. The demo offers keyboard-accessible **Expand selected group**,
**Collapse selected group**, **Expand all**, **Collapse all**, and **Keep expansion
while zooming** controls. Select a triangle to expand a group, or one of its members
to collapse it. Commands preserve the camera.

## Host API

The package exports `ExpansionState` and `ExpansionResult` alongside these methods:

```ts
view.setKeepExpanded(true);
const result = await view.expandCluster(clusterId);
view.collapseCluster(clusterId);
const all = await view.expandAll();
await view.collapseAll();
const state = view.getExpansionState();
```

Call these after `await view.load(...)`. Calls before a tree is ready, after
`dispose`, or during ancillary replacement fail. A new load resets expansion and
persistence. `onNodeSelected` supplies `{ nodeId, clusterId, expandable }` for host
controls. `onExpansionChanged` reports state after graph updates. Selection itself
never sends an expansion request.

`expandCluster`, `expandAll` and `collapseAll` return a promise of `ExpansionResult`.
`collapseCluster` and `setKeepExpanded` return the current `ExpansionState`.

```ts
interface ExpansionState {
  keepExpanded: boolean;
  expandedClusterIds: readonly string[];
  allExpanded: boolean;
  partial: boolean;
  renderedNodeCount: number;
  maxNodes: number;
}
interface ExpansionResult extends ExpansionState {
  status: "complete" | "partial" | "superseded";
}
```

`complete` means the requested operation was applied without truncation;
`superseded` means a newer command, camera query, ancillary replacement or disposal
invalidated it. Network errors reject the promise. A partial expand-all result
always has `allExpanded: false`; hosts must check `status`/`partial` before claiming
that the whole tree is expanded.

## Persistence and automatic detail

By default, expansions last until the next viewport response. Enabling
`keepExpanded` pins the current LoD tier and retains explicit cluster patches
across viewport requests. Panning still queries the corresponding geographic
region at that tier; retained patches are composed with the new base snapshot.
Pinning the tier avoids combining overlapping representatives from different
levels. Turning persistence off resumes automatic semantic zoom and discards
explicit patches on the next accepted response. It does not freeze the camera.

Expand-all requests the finest tier over the whole dataset, within the configured
`load({ lod: { maxNodes } })` budget. With persistence enabled this bounded global
snapshot stays at finest detail while zooming. Collapse-all clears explicit state
and requests the global coarsest tier. Automatic zoom can change that tier again
when persistence is off. Individual collapse applies to individually expanded
groups; use collapse-all to leave an expand-all snapshot.

Persistence belongs to the loaded view, not server storage. Ancillary replacement
fetches the base query and retained cluster patches for the new layout version
before committing them together. Presentation filters are reapplied when patches
are composed.

## Requests and composition

Individual expansion uses the existing viewport endpoint with `cluster_id`,
`lod_level: null` and `max_nodes`. The service returns finest-detail members,
original internal edges, neighboring representatives and boundary meta-edges.
Meta-edges summarize connectivity and never become biological source edges.

The controller retains a base viewport response and expansion responses. A pure
composition step combines them by ID, preferring detailed nodes over neighboring
proxies. Removing one patch reconstructs the graph from the base and remaining
patches, preserving other expansions. Individual collapse needs no server request.

All display snapshots are capped by the configured node budget, including neighbor
context supplied by the server. Edges with omitted endpoints are removed. A
truncated service response, omitted cluster members, or a composition over budget
sets `partial`. An individual group that cannot fit completely keeps its summary
intact instead of mixing that summary with an incomplete set of members. Expand-all
may display a bounded subset of finest-detail nodes. No pagination or unlimited rendering is implied. Increase the
budget on a new load or inspect smaller regions/groups to see additional detail.

Every command invalidates older requests immediately. Camera changes invalidate
in-flight work when a new viewport is scheduled. Only the latest request may
commit; collapsing also invalidates an unfinished expansion, preventing late
responses from reopening it.

## Validation

`docs/validation/explicit-expansion.json` records the real-server browser sequence
on the evaluation generator's 12,001-node Newick. Persistent groups survived fits
and viewport replacement with labels both off and on. Expansion/collapse preserved
the camera; expand-all reported a partial 5,000-node result and collapse-all
returned to 1,500 representatives. Run the sequence through
`/navigation-regression.html` → **Run Newick navigation** with that fixture.

The normal demo was also checked with its 6,000-node limit: the feedback explicitly
reported a partial result. Unit tests cover gesture separation, checkbox behavior,
stale responses after collapse, budgets, zoom-out persistence, ancillary replacement
and public API disposal.

The RQ4 evaluation host now uses explicit command buttons for expand/collapse.
New final observations carry `interaction_protocol: explicit-expansion-v1`;
historical node-gesture observations retain their original validation semantics.
Do not compare gesture timings across protocols without identifying this change.

The RQ4 pilot uses a 2,000-node rendering budget so its initial coarse snapshot
has room for a complete group expansion. The previous 100-node budget filled
the initial slice and now correctly produces a partial result without expansion.
Pilot timings with these different budgets must not be compared directly.
