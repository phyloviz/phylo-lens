# Cluster expansion and collapse

Semantic zoom replaces groups of canonical nodes with representatives. Cluster
expansion allows a user to inspect one group without switching the complete
viewport to the finest LoD tier.

Expansion combines a server read with client-side graph patching. Collapse is a
local restoration of the representative state captured before expansion.

## Interaction model

Current Sigma interaction:

- **single click** on an expandable representative: expand the cluster;
- **double click** on an expanded cluster member or representative context:
  collapse the cached expansion.

Host applications may also invoke the internal workbench navigation path, but the
package-root public API does not currently expose arbitrary cluster identifiers.

## Expandability

A visible node is expandable when it represents more than one canonical member.
The response fields used by the client are:

```text
is_representative = true
member_count > 1
cluster_id = prepared cluster identifier
```

Ordinary finest-detail nodes are not expanded.

## Expansion request

The viewport controller issues:

```json
{
  "dataset_id": "example",
  "layout_version": "...",
  "cluster_id": "distance_cluster_...",
  "focus_node_id": null,
  "lod_level": null,
  "max_nodes": 5000
}
```

`cluster_id` selects the explicit expansion path. Normal camera bounds and LoD
selection are not used.

An optional `focus_node_id` can request a member-centered patch during navigation.

## Server expansion result

The repository resolves the prepared cluster and returns:

1. all member nodes at their global finest-detail positions;
2. original internal edges whose endpoints are both members;
3. neighbouring representatives required to preserve external connectivity;
4. meta-edges that summarize boundary connections.

### Meta-edges

A boundary meta-edge connects a returned member or expansion context to a
neighbouring representative. It carries:

```text
is_meta = true
bundled_edge_count = number of original boundary edges represented
```

Meta-edges are visual connectivity summaries. They are not added to the
canonical graph or persisted as new biological relationships.

## Client patch application

Before requesting expansion, the controller captures:

- a clone of the representative node;
- its currently visible incident edges;
- the cluster identifier.

When the response arrives, the client converts it to a positioned graph and
merges it into the current snapshot. Existing nodes and edges with the same
identifier are replaced deterministically.

The current camera is preserved unless the expansion was requested with an
explicit fit operation.

## Collapse

Collapse uses the cached pre-expansion snapshot:

1. remove all cached cluster members;
2. remove expansion edges touching those members;
3. restore the representative;
4. restore captured incident edges whose endpoints remain present;
5. deduplicate edges by identifier;
6. apply the restored graph to Sigma.

Collapse does not issue an HTTP request. It restores the coarse representation
that existed when the cluster was expanded.

## Concurrent viewport requests

Expansion shares the viewport controller request sequence with camera reads.
Only the newest request may commit a graph patch. A late expansion response is
ignored if a newer viewport or expansion request has superseded it.

Unmounting or disposing the view also invalidates pending expansion results.

## Interaction with semantic zoom

An expanded cluster is a client-side patch over the current viewport. A later
camera-driven snapshot may replace that graph and therefore remove the expansion.
Expansion is not a persistent server-side state and is not encoded in the next
ordinary viewport query.

This behavior keeps the HTTP contract stateless. A future persistent-expansion
model would need to carry expanded cluster identifiers in viewport requests and
is outside the current contract.

## Metadata behavior

The collapsed representative carries aggregated cluster metadata. Expanded
members carry individual public node metadata. The user therefore moves from a
summary record to the underlying member records without changing the canonical
metadata store.

## Limitations

- The package-root API does not currently expose programmatic expand/collapse
  methods.
- Expanded state is not preserved across ordinary viewport replacement.
- Collapse relies on the client snapshot captured at expansion time.
- A very large cluster may return more nodes than an ordinary bounded viewport;
  expansion should be treated as an explicit detail operation.

## Correctness invariants

- Every expansion edge references a returned node.
- Canonical internal edges are preserved between returned members.
- External connectivity is represented by neighbouring representatives and
  meta-edges.
- Collapse restores the original representative rather than synthesizing a new
  node.
- Meta-edges never become canonical or prepared source edges.
