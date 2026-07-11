import type Graph from "graphology";
import type { PositionedGraph } from "../../../contracts/positioned";
import {
  firstAttributeValue,
  normalizeRoleValue,
  toPositiveNumber,
} from "./sigmaAttributeUtils";
import { formatDistanceLabel } from "./sigmaLabels";
import {
  PHYLOVIZ_EDGE_DLV_COLOR,
  PHYLOVIZ_EDGE_TIEBREAK_NONE_COLOR,
  PHYLOVIZ_EDGE_TIEBREAK_RULE_1_COLOR,
  PHYLOVIZ_EDGE_TIEBREAK_RULE_2_COLOR,
  PHYLOVIZ_EDGE_TIEBREAK_RULE_3_COLOR,
  PHYLOVIZ_EDGE_TIEBREAK_RULE_4_OR_5_COLOR,
  PHYLOVIZ_EDGE_TLV_COLOR,
  SIGMA_DEFAULT_EDGE_SIZE,
} from "./sigmaRenderingConstants";
import type { SigmaRendererOptions } from "./sigmaTypes";
import { edgeSizeForDistance } from "./sigmaStyle";

export function addPositionedEdges(
  graph: Graph,
  positionedGraph: PositionedGraph,
  rendererOptions: SigmaRendererOptions,
): void {
  const distanceRange = distanceRangeForEdges(positionedGraph.edges);

  positionedGraph.edges.forEach((edge) => {
    const sourceExists = graph.hasNode(edge.source);
    const targetExists = graph.hasNode(edge.target);

    if (!sourceExists || !targetExists) {
      return;
    }

    graph.addEdgeWithKey(edge.id, edge.source, edge.target, {
      ...(edge.attributes ?? {}),
      color: deriveEdgeColor(edge.attributes, distanceRange),
      size: deriveEdgeSize(edge.attributes, rendererOptions),
      label:
        rendererOptions.display?.edgeDistanceLabels === true
          ? formatDistanceLabel(edge.attributes?.distance)
          : "",
      forceLabel: rendererOptions.display?.edgeDistanceLabels === true,
    });
  });
}

function deriveEdgeSize(
  attributes: Record<string, unknown> | undefined,
  rendererOptions: SigmaRendererOptions,
): number {
  const baseSize = rendererOptions.edge?.size ?? SIGMA_DEFAULT_EDGE_SIZE;
  return edgeSizeForDistance(
    toPositiveNumber(attributes?.distance),
    baseSize,
    rendererOptions.display?.distanceWeightedEdges === true,
  );
}

function deriveEdgeColor(
  attributes: Record<string, unknown> | undefined,
  distanceRange: { min: number; max: number } | null,
): string {
  const tiebreakColor = deriveTiebreakEdgeColor(attributes);
  if (tiebreakColor) {
    return tiebreakColor;
  }

  const distance = toPositiveNumber(attributes?.distance);
  if (distanceRange && distance > 0) {
    return grayscaleForDistance(distance, distanceRange);
  }

  return PHYLOVIZ_EDGE_TIEBREAK_NONE_COLOR;
}

function deriveTiebreakEdgeColor(
  attributes: Record<string, unknown> | undefined,
): string | null {
  const rawRule = firstAttributeValue(attributes, [
    "tie_break_rule",
    "tiebreak_rule",
    "tiebreak",
    "tie_break",
    "goeburst_rule",
    "rule",
    "level",
  ]);
  const rule = normalizeRoleValue(rawRule);

  if (
    rule === "none" ||
    rule === "no_tiebreak" ||
    rule === "without_tiebreak"
  ) {
    return PHYLOVIZ_EDGE_TIEBREAK_NONE_COLOR;
  }
  if (rule === "1" || rule === "rule_1" || rule === "slv") {
    return PHYLOVIZ_EDGE_TIEBREAK_RULE_1_COLOR;
  }
  if (rule === "2" || rule === "rule_2") {
    return PHYLOVIZ_EDGE_TIEBREAK_RULE_2_COLOR;
  }
  if (rule === "3" || rule === "rule_3") {
    return PHYLOVIZ_EDGE_TIEBREAK_RULE_3_COLOR;
  }
  if (
    rule === "4" ||
    rule === "5" ||
    rule === "rule_4" ||
    rule === "rule_5"
  ) {
    return PHYLOVIZ_EDGE_TIEBREAK_RULE_4_OR_5_COLOR;
  }
  if (rule === "dlv") {
    return PHYLOVIZ_EDGE_DLV_COLOR;
  }
  if (rule === "tlv") {
    return PHYLOVIZ_EDGE_TLV_COLOR;
  }

  return null;
}

function distanceRangeForEdges(
  edges: PositionedGraph["edges"],
): { min: number; max: number } | null {
  const distances = edges
    .map((edge) => edge.attributes?.distance)
    .filter(
      (distance): distance is number =>
        typeof distance === "number" && Number.isFinite(distance),
    );
  if (distances.length === 0) {
    return null;
  }

  return {
    min: Math.min(...distances),
    max: Math.max(...distances),
  };
}

function grayscaleForDistance(
  distance: number,
  range: { min: number; max: number },
): string {
  const normalized =
    range.max === range.min
      ? 0
      : Math.min(
          1,
          Math.max(0, (distance - range.min) / (range.max - range.min)),
        );
  // Keep the distance ordering, but avoid near-white links disappearing on
  // Sigma's white canvas.
  const channel = Math.round(35 + normalized * 115);
  const hex = channel.toString(16).padStart(2, "0");
  return `#${hex}${hex}${hex}`;
}
