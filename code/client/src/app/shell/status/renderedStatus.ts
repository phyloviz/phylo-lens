import type { PositionedGraph } from "../../../contracts/positioned";

export const STATUS_RENDERED_PREFIX = "Rendered";
// Degraded is retained only when reading a layout created by an earlier service
// version; current preparation never silently substitutes a fallback layout.
export const STATUS_DEGRADED_LAYOUT_WARNING = "⚠ This stored layout was prepared by an earlier service version";

export function buildRenderedStatus(graph: PositionedGraph): string {
  const parts = [`${graph.nodes.length} nodes`, `${graph.edges.length} edges`, lodTierLabel(graph)];

  if (typeof graph.viewMeta.sliceNodeCount === "number") {
    parts.push(`slice ${graph.viewMeta.sliceNodeCount} nodes`);
  }

  if (typeof graph.viewMeta.zoom === "number") {
    parts.push(`LoD zoom ${graph.viewMeta.zoom.toFixed(2)}`);
  }

  const status = `${STATUS_RENDERED_PREFIX}: ${parts.join(", ")}`;
  const warnings = statusWarnings(graph);
  return warnings.length > 0 ? `${status} — ${warnings.join(" — ")}` : status;
}

function statusWarnings(graph: PositionedGraph): string[] {
  const warnings: string[] = [];
  const prepareWarning = graph.viewMeta.layoutWarnings?.find((warning) => warning.trim().length > 0);
  if (prepareWarning) {
    warnings.push(prepareWarning);
  }
  if (graph.viewMeta.layoutStatus === "degraded" && !isLayoutWarning(prepareWarning)) {
    warnings.push(STATUS_DEGRADED_LAYOUT_WARNING);
  }
  return warnings;
}

function isLayoutWarning(warning: string | undefined): boolean {
  if (!warning) {
    return false;
  }
  const normalized = warning.toLowerCase();
  return normalized.includes("graphviz") || normalized.includes("layout");
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
