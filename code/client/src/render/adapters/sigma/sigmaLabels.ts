import type { EdgeLabelDrawingFunction, NodeLabelDrawingFunction } from "sigma/rendering";
import { isUnionNode } from "../../unionNodes";
import { SIGMA_DEFAULT_LABEL_COLOR } from "./sigmaRenderingConstants";

export function deriveNodeLabel(nodeId: string, attributes: Record<string, unknown> | undefined): string {
  if (isUnionNode(nodeId, attributes)) {
    return "";
  }

  const explicitLabel = attributes?.label;
  if (typeof explicitLabel === "string" && explicitLabel.trim().length > 0) {
    return explicitLabel.trim();
  }

  if (attributes?.is_cluster_proxy === true) {
    return "";
  }

  const metadataCandidate = attributes?.metadata;
  if (metadataCandidate && typeof metadataCandidate === "object") {
    const metadata = metadataCandidate as Record<string, unknown>;
    const name = metadata.name;
    if (typeof name === "string" && name.trim().length > 0) {
      return name.trim();
    }
  }

  return nodeId;
}

export function formatDistanceLabel(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "";
  }

  return Number.isInteger(value) ? String(value) : value.toFixed(3);
}

export const drawCenteredNodeLabel: NodeLabelDrawingFunction = (context, data, settings) => {
  if (!data.label) {
    return;
  }

  const label = fitLabelToNode(context, data.label, data.size * 1.75);
  if (!label) {
    return;
  }

  context.save();
  context.font = `${settings.labelWeight} ${Math.max(
    8,
    Math.min(settings.labelSize, data.size * 0.9),
  )}px ${settings.labelFont}`;
  context.fillStyle = resolveLabelColor(data, settings);
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(label, data.x, data.y);
  context.restore();
};

export const drawDistanceEdgeLabel: EdgeLabelDrawingFunction = (
  context,
  edgeData,
  sourceData,
  targetData,
  settings,
) => {
  if (!edgeData.label) {
    return;
  }

  const x = (sourceData.x + targetData.x) / 2;
  const y = (sourceData.y + targetData.y) / 2;

  context.save();
  context.font = `${settings.edgeLabelWeight} ${settings.edgeLabelSize}px ${settings.edgeLabelFont}`;
  context.fillStyle = resolveEdgeLabelColor(edgeData, settings);
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.lineWidth = 4;
  context.strokeStyle = "rgba(255, 255, 255, 0.86)";
  context.strokeText(edgeData.label, x, y);
  context.fillText(edgeData.label, x, y);
  context.restore();
};

function fitLabelToNode(context: CanvasRenderingContext2D, label: string, maxWidth: number): string {
  if (maxWidth <= 4) {
    return "";
  }

  if (context.measureText(label).width <= maxWidth) {
    return label;
  }

  let clipped = label;
  while (clipped.length > 1) {
    clipped = clipped.slice(0, -1);
    const candidate = `${clipped}...`;
    if (context.measureText(candidate).width <= maxWidth) {
      return candidate;
    }
  }

  return "";
}

function resolveLabelColor(
  data: Record<string, unknown>,
  settings: { labelColor: { attribute?: string; color?: string } },
): string {
  const attribute = settings.labelColor.attribute;
  if (attribute && typeof data[attribute] === "string") {
    return data[attribute];
  }

  return settings.labelColor.color ?? SIGMA_DEFAULT_LABEL_COLOR;
}

function resolveEdgeLabelColor(
  data: Record<string, unknown>,
  settings: { edgeLabelColor: { attribute?: string; color?: string } },
): string {
  const attribute = settings.edgeLabelColor.attribute;
  if (attribute && typeof data[attribute] === "string") {
    return data[attribute];
  }

  return settings.edgeLabelColor.color ?? SIGMA_DEFAULT_LABEL_COLOR;
}
