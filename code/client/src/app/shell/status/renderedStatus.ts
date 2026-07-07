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
    lodTierLabel(graph),
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

// Human-readable current LoD tier. When the tier count is known it reads
// "LoD tier X/Y" (1-based) so a semantic-zoom transition is visible even when
// the coarse tier looks like plain leaves; otherwise it falls back to the raw
// rendered depth.
function lodTierLabel(graph: PositionedGraph): string {
  const tierCount = graph.viewMeta.lodTierCount;
  if (typeof tierCount === "number" && tierCount > 0) {
    const tier = Math.min(graph.viewMeta.lodLevel + 1, tierCount);
    return `LoD tier ${tier}/${tierCount}`;
  }
  return `rendered depth ${graph.viewMeta.lodLevel}`;
}
