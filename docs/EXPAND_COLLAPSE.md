# Cluster expansion and collapse

Click selects a node. Double-click and the mouse wheel zoom; neither invokes an
expansion command. The demo offers keyboard-accessible **Expand selected branch or group**,
**Collapse selected branch or group**, **Expand all**, **Collapse all**, and **Keep expansion
while zooming** controls. Select a triangle to expand a group, or one of its members
to collapse it. Commands preserve the camera.

## Manual branch collapse

An ordinary internal node can be collapsed in a streamed viewport. Preparation
assigns every canonical node a half-open DFS subtree interval, parent, component
and true hop depth. Viewport responses carry the index for their returned nodes;
the browser does not need a full canonical snapshot to identify descendants.
Parentage follows the Newick serialization root or the typing tree's technical
root. The arrangement root used for dragging does not change it.

A manual marker stays circular, with a teal ring and, when labels are enabled,
a `(+N)` label for its canonical descendants. A server LoD aggregate stays
triangular. The marker retains its own identity and observations; hidden nodes
are not merged into its ancillary data. Leaves cannot be collapsed.

Use `collapseBranch(nodeId)` and `expandBranch(nodeId)` for manual branches;
use `collapseCluster(clusterId)` and `expandCluster(clusterId)` for LoD groups.
These identities differ: members of an expanded group can share a cluster ID.
Manual commands are local and synchronous. Expanding a marker restores the
representations and edges available in the current slice; normal viewport reads
continue to supply the rest as the user navigates.

Fold intentions survive pan, zoom, filters and ancillary replacement. A coarser
LoD aggregate can subsume a fold temporarily; its normal triangle remains and
the manual marker returns when detail reveals that node again. Expanding an
outer manual fold retains nested fold choices. Search opens containing folds to
reveal its hidden target. Filters do not clear folds. A new dataset or Expand all
clears them. Collapse all requests the global coarsest tier, then folds each
returned component root in one batch. Explicit node budgets can make that result
partial. [Indexed branch operations](TREE_INDEX.md) describes costs and invariants.

## Host API

The package exports `ExpansionState` and `ExpansionResult` alongside these methods:

```ts
view.setKeepExpanded(true);
const result = await view.expandCluster(clusterId);
view.collapseCluster(clusterId);
view.collapseBranch(nodeId);
view.expandBranch(nodeId);
const all = await view.expandAll();
await view.collapseAll();
const state = view.getExpansionState();
```

Call these after `await view.load(...)`. Calls before a tree is ready, after
`dispose`, or during ancillary replacement fail. A new load resets expansion and
persistence. `onNodeSelected` supplies `{ nodeId, clusterId, expandable }` for host
controls. `onExpansionChanged` reports state after graph updates. Selection itself
never sends an expansion request.
For an indexed internal node, selection also supplies `collapsible`; a manual
marker supplies `manuallyCollapsed: true` and `expandable: true`.

`expandCluster`, `expandAll` and `collapseAll` return a promise of `ExpansionResult`.
`collapseCluster`, `collapseBranch`, `expandBranch` and `setKeepExpanded` return
the current `ExpansionState`.

```ts
interface ExpansionState {
  keepExpanded: boolean;
  expandedClusterIds: readonly string[];
  allExpanded: boolean;
  partial: boolean;
  renderedNodeCount: number;
  maxNodes?: number;
  manuallyCollapsedBranchCount?: number;
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
Pinning the effective tier bypasses adaptive density selection and avoids
combining overlapping representatives from different levels. Turning persistence off resumes automatic semantic zoom and discards
explicit patches on the next accepted response. It does not freeze the camera.

Expand-all requests the finest tier over the whole dataset. A count budget
applies only when `load({ lod: { maxNodes } })` explicitly supplies one; otherwise
every original node is returned. With persistence enabled this global
snapshot stays at finest detail while zooming. Collapse-all clears explicit state, requests the global coarsest tier and folds
its component roots. Automatic zoom can change that tier again
when persistence is off. Individual collapse applies to individually expanded
groups; use collapse-all to leave an expand-all snapshot.

Persistence belongs to the loaded view, not server storage. Ancillary replacement
fetches the base query and retained cluster patches for the new layout version
before committing them together. Presentation filters are reapplied when patches
are composed.

## Requests and composition

Individual expansion uses the existing viewport endpoint with `cluster_id`,
`lod_level: null` and optional explicit `max_nodes`. The service returns finest-detail members,
original internal edges, neighboring representatives and boundary meta-edges.
Meta-edges summarize connectivity and never become biological source edges.

The controller retains a base viewport response and expansion responses. A pure
composition step combines them by ID, preferring detailed nodes over neighboring
proxies. Removing one patch reconstructs the graph from the base and remaining
patches, preserving other expansions. Individual collapse needs no server request.

Normal display snapshots and composition have no node-count cap, including
neighbor context supplied by the server. Only an explicit `lod.maxNodes` bounds
composition and queries. Then edges with omitted endpoints are removed, and a
truncated response, omitted members, or composition over budget sets `partial`.
An individual group that cannot fit completely keeps its summary intact.
Without a caller budget, expand-all retains all finest-detail original nodes;
LoD aggregation and viewport bounds support normal progressive navigation.

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

That historical demo run used the former 6,000-node default (now removed): the feedback explicitly
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
