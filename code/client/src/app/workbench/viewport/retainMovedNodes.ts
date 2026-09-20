import type { GraphViewportResponse } from "../../../api/graphContracts";

/** A node dragged into view must not disappear just because a budgeted server
 * query omits its original position. Merge raw records before visual filters,
 * only within the same dataset, layout version and tier. Never exceed the budget.
 */
export function retainMovedNodes(
  next: GraphViewportResponse,
  previous: GraphViewportResponse | null,
  visibleMovedIds: readonly string[],
  maxNodes: number,
): GraphViewportResponse {
  if (
    !previous ||
    !visibleMovedIds.length ||
    next.dataset_id !== previous.dataset_id ||
    next.layout_version !== previous.layout_version ||
    next.lod_level !== previous.lod_level
  )
    return next;

  const incoming = new Map(next.nodes.map((n) => [n.id, n]));
  const old = new Map(previous.nodes.map((n) => [n.id, n]));
  const nodes = new Map<string, GraphViewportResponse["nodes"][number]>();

  for (const id of visibleMovedIds) {
    const n = incoming.get(id) ?? old.get(id);
    if (n && nodes.size < maxNodes) nodes.set(id, n);
  }

  for (const n of next.nodes) {
    if (nodes.size < maxNodes || nodes.has(n.id)) {
      nodes.set(n.id, n);
    }
  }

  const edges = new Map(
    [...previous.edges, ...next.edges].filter((e) => nodes.has(e.source) && nodes.has(e.target)).map((e) => [e.id, e]),
  );
  const dropped = next.nodes.some((n) => !nodes.has(n.id));

  return { ...next, nodes: [...nodes.values()], edges: [...edges.values()], truncated: next.truncated || dropped };
}
