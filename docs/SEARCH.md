# Isolate search and navigation

Search covers the persisted dataset, including profiles outside the viewport and
members of collapsed groups. Results identify the biological profile to focus;
`matched_text` preserves the original isolate ID that matched. Multiple isolates
in one profile produce one result, with its strongest match.

Original isolate IDs are compared literally with Unicode case folding. Leading
zeros, internal whitespace, punctuation, `%` and `_` remain significant. Query
whitespace at the ends is trimmed. Ranking is exact ID (100), ID prefix (60), ID
substring (40), then ancillary value (20), with profile ID breaking ties. Node ID
and ancillary-value matching also remain available. `total_count` counts matching
profiles before the result limit, not matching isolates.

## Host API

```ts
const results = await view.searchNodes({ query: "B.02", limit: 25 });
const match = results.matches[0];
if (match) {
  await view.focusNode(match.node_id, {
    x: match.x ?? null,
    y: match.y ?? null,
    clusterId: match.cluster_id,
  });
}
```

`focusNode` takes a profile/node ID. If coordinates and cluster are omitted, it
resolves the layout location through search. It recenters even if the same target
was selected before. The highlighted target has priority within the rendering
budget; a second target in the same partially loaded cluster is fetched again.
Focus does not promise that every member of the containing group is visible.

A newer focus or search invalidates pending focus work. Dataset replacement and
disposal invalidate the old controller. A superseded focus resolves without
applying its response or moving the camera. Host UIs should similarly ignore old
search responses and completion messages; call `cancelPendingFocus()` when an
input edit dismisses results without issuing a new search. The demo implements
these guards for edits, searches, selections, reloads and disposal.

## Validation

- Persisted synthetic profiles cover original IDs with punctuation, spaces,
  leading zeros and Unicode, exact/prefix/substring ranking and literal wildcards.
- Client regressions cover responses/errors out of order, cancelled focus, a full
  node budget, and successive members of a partial cluster.
- Open `/search-regression.html` on the development server and select the
  deterministic 6,001-leaf RQ4 Newick (12,001 nodes). The real-server browser replay
  uses a two-node budget, focuses collapsed and offscreen targets, repeats focus
  after panning, and releases an older response after a newer visible selection.
  All four operations passed. The final target remains visible and highlighted.

Camera projection and unprojection use the same fixed reference camera, avoiding
stale frame matrices during rapid focus operations.
