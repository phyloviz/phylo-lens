import type { PositionedGraph } from "../../../contracts/positioned";

export const STATUS_RENDERED_PREFIX = "Rendered";
// Prefix for the degraded-layout notice: the force layout fell back to a
// circular scatter that ignores tree topology, so the view is not a faithful
// layout. Surfacing this explains a distorted-looking tier instead of letting
// it read as a real topology change.
export const STATUS_DEGRADED_LAYOUT_WARNING =
  "⚠ Degraded layout (force layout unavailable — positions ignore tree topology)";

export function buildRenderedStatus(graph: PositionedGraph): string {
  const parts = [
    `${graph.nodes.length} nodes`,
    `${graph.edges.length} edges`,
    `rendered depth ${graph.viewMeta.lodLevel}`,
  ];

  if (typeof graph.viewMeta.sliceNodeCount === "number") {
    parts.push(`slice ${graph.viewMeta.sliceNodeCount} nodes`);
  }

  if (typeof graph.viewMeta.zoom === "number") {
    parts.push(`LoD zoom ${graph.viewMeta.zoom.toFixed(2)}`);
  }

  const status = `${STATUS_RENDERED_PREFIX}: ${parts.join(", ")}`;
  return graph.viewMeta.layoutStatus === "degraded"
    ? `${status} — ${STATUS_DEGRADED_LAYOUT_WARNING}`
    : status;
}
