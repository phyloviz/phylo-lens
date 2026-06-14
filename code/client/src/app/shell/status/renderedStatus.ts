import type { PositionedGraph } from "../../../contracts/positioned";

export const STATUS_RENDERED_PREFIX = "Rendered";

export function buildRenderedStatus(graph: PositionedGraph): string {
  const parts = [
    `${graph.nodes.length} nodes`,
    `${graph.edges.length} edges`,
    `rendered depth ${graph.viewMeta.lodLevel}`,
  ];

  if (typeof graph.viewMeta.sliceNodeCount === "number") {
    parts.push(`slice ${graph.viewMeta.sliceNodeCount} nodes`);
  }

  if (typeof graph.viewMeta.collapsedClusterCount === "number") {
    parts.push(`${graph.viewMeta.collapsedClusterCount} collapsed clusters`);
  }

  if (typeof graph.viewMeta.zoom === "number") {
    parts.push(`LoD zoom ${graph.viewMeta.zoom.toFixed(2)}`);
  }

  return `${STATUS_RENDERED_PREFIX}: ${parts.join(", ")}`;
}
