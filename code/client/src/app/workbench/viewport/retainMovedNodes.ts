import type { NodeId } from "../../../contracts/graph/graphIdentifiers";
import type { GraphViewportResult } from "../../../contracts/graph/viewport/GraphViewportResult";

/** A node dragged into view must not disappear just because a budgeted server
 * query omits its original position. Merge raw records before visual filters,
 * only within the same dataset, layout version and tier. Only enforce a budget when explicitly supplied.
 */
export function retainMovedNodes(
  next: GraphViewportResult,
  previous: GraphViewportResult | null,
  visibleMovedIds: readonly NodeId[],
  maxNodes: number | undefined,
): GraphViewportResult {
  if (
    !previous ||
    !visibleMovedIds.length ||
    next.datasetId !== previous.datasetId ||
    next.layoutVersion !== previous.layoutVersion ||
    next.lodLevel !== previous.lodLevel
  )
    return next;

  const incoming = new Map(next.nodes.map((n) => [n.id, n]));
  const old = new Map(previous.nodes.map((n) => [n.id, n]));
  const nodes = new Map<NodeId, GraphViewportResult["nodes"][number]>();

  for (const id of visibleMovedIds) {
    const n = incoming.get(id) ?? old.get(id);
    if (n && (maxNodes === undefined || nodes.size < maxNodes)) nodes.set(id, n);
  }

  for (const n of next.nodes) {
    if (maxNodes === undefined || nodes.size < maxNodes || nodes.has(n.id)) {
      nodes.set(n.id, n);
    }
  }

  const edges = new Map(
    [...previous.edges, ...next.edges].filter((e) => nodes.has(e.source) && nodes.has(e.target)).map((e) => [e.id, e]),
  );
  const dropped = next.nodes.some((n) => !nodes.has(n.id));

  return { ...next, nodes: [...nodes.values()], edges: [...edges.values()], truncated: next.truncated || dropped };
}
