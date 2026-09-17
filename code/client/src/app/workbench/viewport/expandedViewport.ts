import type { PositionedGraph } from "../../../contracts/positioned";

/** Compose patches at the same LoD tier. Detailed nodes win over boundary proxies. */
export function composeExpandedViewport(base: PositionedGraph, patches: readonly PositionedGraph[], maxNodes: number) {
  const nodes = new Map(base.nodes.map((node) => [node.id, node]));
  const edges = new Map(base.edges.map((edge) => [edge.id, edge]));
  for (const patch of patches) {
    for (const node of patch.nodes) {
      if (node.attributes?.is_cluster_proxy !== true || !nodes.has(node.id)) nodes.set(node.id, node);
    }
    for (const edge of patch.edges) edges.set(edge.id, edge);
  }
  // Expanded members replace their summary; counting both would duplicate isolates.
  const detailedClusters = new Set(
    patches.flatMap((patch) =>
      patch.nodes
        .filter((node) => node.attributes?.is_cluster_proxy !== true)
        .map((node) => node.attributes?.cluster_id),
    ),
  );
  for (const [id, node] of nodes) {
    if (node.attributes?.is_cluster_proxy === true && detailedClusters.has(node.attributes?.cluster_id))
      nodes.delete(id);
  }
  const partial = nodes.size > maxNodes;
  const rendered = [...nodes.values()].slice(0, maxNodes);
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
