import type { PositionedGraph } from "../../../contracts/positioned";

/** Compose patches at the same LoD tier. Detailed nodes win over boundary proxies. */
export function composeExpandedViewport(
  base: PositionedGraph,
  patches: readonly PositionedGraph[],
  maxNodes: number | undefined,
  priorityNodeId?: string | null,
) {
  const nodes = new Map(base.nodes.map((node) => [node.id, node]));
  const edges = new Map(base.edges.map((edge) => [edge.id, edge]));
  const boundaryPairs = new Set(
    patches.flatMap((patch) =>
      patch.edges
        .filter((edge) => edge.attributes?.isMeta === true)
        .map((edge) => [edge.source, edge.target].sort().join("\0")),
    ),
  );
  for (const [id, edge] of edges) {
    if (boundaryPairs.has([edge.source, edge.target].sort().join("\0"))) edges.delete(id);
  }
  for (const patch of patches) {
    for (const node of patch.nodes) {
      if (node.attributes?.isClusterProxy !== true || !nodes.has(node.id)) nodes.set(node.id, node);
    }
    for (const edge of patch.edges) edges.set(edge.id, edge);
  }
  // Expanded members replace their summary; counting both would duplicate isolates.
  const detailedClusters = new Set(
    patches.flatMap((patch) =>
      patch.nodes
        .filter((node) => node.attributes?.isClusterProxy !== true)
        .map((node) => node.attributes?.clusterId)
        .filter((id): id is string => typeof id === "string"),
    ),
  );
  for (const [id, node] of nodes) {
    const clusterId = node.attributes?.clusterId;
    if (node.attributes?.isClusterProxy === true && typeof clusterId === "string" && detailedClusters.has(clusterId))
      nodes.delete(id);
  }
  const partial = maxNodes !== undefined && nodes.size > maxNodes;
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
