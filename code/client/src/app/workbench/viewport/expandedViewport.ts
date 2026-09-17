import type { PositionedGraph } from "../../../contracts/positioned";

/** Compose patches at the same LoD tier. Detailed nodes win over boundary proxies. */
export function composeExpandedViewport(
  base: PositionedGraph,
  patches: readonly PositionedGraph[],
  maxNodes: number,
  priorityNodeId?: string | null,
) {
  const nodes = new Map(base.nodes.map((node) => [node.id, node]));
  const edges = new Map(base.edges.map((edge) => [edge.id, edge]));
  for (const patch of patches) {
    for (const node of patch.nodes) {
      if (node.attributes?.is_cluster_proxy !== true || !nodes.has(node.id)) nodes.set(node.id, node);
    }
    for (const edge of patch.edges) edges.set(edge.id, edge);
  }
  const partial = nodes.size > maxNodes;
  const ordered = [...nodes.values()];
  const priority = priorityNodeId ? nodes.get(priorityNodeId) : undefined;
  const rendered = (priority ? [priority, ...ordered.filter((node) => node.id !== priority.id)] : ordered).slice(
    0,
    maxNodes,
  );
  const ids = new Set(rendered.map((node) => node.id));
  const visibleEdges = [...edges.values()].filter((edge) => ids.has(edge.source) && ids.has(edge.target));
  return {
    partial,
    graph: {
      nodes: rendered,
      edges: visibleEdges,
      viewMeta: { ...base.viewMeta, sliceNodeCount: rendered.length, sliceEdgeCount: visibleEdges.length },
    } satisfies PositionedGraph,
  };
}
