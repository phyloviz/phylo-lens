import { createNodePiechartProgram } from "@sigma/node-piechart";
import { createNodeBorderProgram } from "@sigma/node-border";
import type {
  EdgeLabelDrawingFunction,
  NodeLabelDrawingFunction,
} from "sigma/rendering";
import type Graph from "graphology";

import type {
  PositionedGraph,
  PositionedNode,
} from "../../../contracts/positioned";
import {
  buildPiePalette,
  PIE_CATEGORY_COLORS_ATTRIBUTE,
  PIE_ATTRIBUTE_PREFIX,
  PIE_OTHER_SLICE_COLOR,
  PIE_OTHER_SLICE_KEY,
  PIE_PALETTE_ATTRIBUTE,
} from "../../pieMapping";
import { TriangleNodeProgram } from "../../nodePrograms/triangleNodeProgram";
import {
  SIGMA_MAX_CAMERA_RATIO,
  SIGMA_MIN_CAMERA_RATIO,
  SIGMA_ZOOMING_RATIO,
} from "./sigmaCamera";
import type { GraphDisplayOptions } from "../../types";

export const SIGMA_DEFAULT_NODE_SIZE = 6;
export const SIGMA_DEFAULT_NODE_COLOR = "#0f766e";
export const SIGMA_DEFAULT_EDGE_COLOR = "#94a3b8";
export const SIGMA_DEFAULT_EDGE_SIZE = 1.25;
export const SIGMA_DISTANCE_EDGE_SIZE_FACTOR = 0.75;
export const PHYLOVIZ_EDGE_TIEBREAK_NONE_COLOR = "#000000";
export const PHYLOVIZ_EDGE_TIEBREAK_RULE_1_COLOR = "#2563eb";
export const PHYLOVIZ_EDGE_TIEBREAK_RULE_2_COLOR = "#16a34a";
export const PHYLOVIZ_EDGE_TIEBREAK_RULE_3_COLOR = "#dc2626";
export const PHYLOVIZ_EDGE_TIEBREAK_RULE_4_OR_5_COLOR = "#ca8a04";
export const PHYLOVIZ_EDGE_DLV_COLOR = "#6b7280";
export const PHYLOVIZ_EDGE_TLV_COLOR = "#d1d5db";
export const PHYLOVIZ_NODE_GROUP_FOUNDER_COLOR = "#86efac";
export const PHYLOVIZ_NODE_SUBGROUP_FOUNDER_COLOR = "#15803d";
export const PHYLOVIZ_NODE_COMMON_COLOR = "#93c5fd";
export const PHYLOVIZ_NODE_SELECTED_COLOR = "#dc2626";
export const PHYLOVIZ_NODE_SELECTED_BORDER_COLOR = "#ffffff";

export const SIGMA_DEFAULT_LABEL_COLOR = "#0f172a";
export const SIGMA_DEFAULT_LABEL_SIZE = 13;
export const SIGMA_DEFAULT_LABEL_DENSITY = 0.9;
export const SIGMA_DEFAULT_LABEL_GRID_CELL_SIZE = 90;
export const SIGMA_DEFAULT_LABEL_RENDERED_SIZE_THRESHOLD = 4;
export const INTERNAL_NODE_ID_PREFIX = "internal_";

export const SIGMA_NODE_TYPE_DEFAULT = "circle";
export const SIGMA_NODE_TYPE_BORDER = "border";
export const SIGMA_NODE_TYPE_TRIANGLE = "triangle";
export const SIGMA_NODE_TYPE_PIECHART = "piechart";

export interface SigmaPiechartOptions {
  enabled?: boolean;
  palette?: string[];
}

export interface SigmaRendererOptions {
  piechart?: SigmaPiechartOptions;
  display?: GraphDisplayOptions;
  label?: {
    enabled?: boolean;
    color?: string;
    size?: number;
    density?: number;
    gridCellSize?: number;
    renderedSizeThreshold?: number;
  };
  edge?: {
    size?: number;
    color?: string;
    labelColor?: string;
    labelSize?: number;
  };
}

export type SigmaNodeProgramClasses = Record<string, unknown>;

export function buildSigmaSettings(
  rendererOptions: SigmaRendererOptions,
  nodeProgramClasses: SigmaNodeProgramClasses = {},
): Record<string, unknown> {
  const nodeLabelsEnabled = rendererOptions.display?.nodeLabels !== false;
  const edgeDistanceLabelsEnabled =
    rendererOptions.display?.edgeDistanceLabels === true;

  return {
    renderLabels: rendererOptions.label?.enabled !== false && nodeLabelsEnabled,
    renderEdgeLabels: edgeDistanceLabelsEnabled,
    minCameraRatio: SIGMA_MIN_CAMERA_RATIO,
    maxCameraRatio: SIGMA_MAX_CAMERA_RATIO,
    zoomingRatio: SIGMA_ZOOMING_RATIO,
    labelRenderedSizeThreshold:
      rendererOptions.label?.renderedSizeThreshold ??
      SIGMA_DEFAULT_LABEL_RENDERED_SIZE_THRESHOLD,
    labelDensity: rendererOptions.label?.density ?? SIGMA_DEFAULT_LABEL_DENSITY,
    labelGridCellSize:
      rendererOptions.label?.gridCellSize ?? SIGMA_DEFAULT_LABEL_GRID_CELL_SIZE,
    labelColor: {
      color: rendererOptions.label?.color ?? SIGMA_DEFAULT_LABEL_COLOR,
    },
    labelSize: rendererOptions.label?.size ?? SIGMA_DEFAULT_LABEL_SIZE,
    edgeLabelColor: {
      color: rendererOptions.edge?.labelColor ?? SIGMA_DEFAULT_LABEL_COLOR,
    },
    edgeLabelSize: rendererOptions.edge?.labelSize ?? 11,
    defaultDrawEdgeLabel: drawDistanceEdgeLabel,
    defaultDrawNodeLabel: drawCenteredNodeLabel,
    nodeProgramClasses: {
      [SIGMA_NODE_TYPE_BORDER]: createNodeBorderProgram({
        drawLabel: drawCenteredNodeLabel,
        borders: [
          {
            size: { value: 4, mode: "pixels" },
            color: { attribute: "borderColor" },
          },
          {
            size: { fill: true },
            color: { attribute: "color" },
          },
        ],
      }),
      [SIGMA_NODE_TYPE_TRIANGLE]: TriangleNodeProgram,
      ...nodeProgramClasses,
    },
  };
}

export function addPositionedNode(
  graph: Graph,
  node: PositionedNode,
  pieSliceKeys: readonly string[],
  rendererOptions: SigmaRendererOptions,
  selectedNodeId?: string | null,
): void {
  const pieAttributes: Record<string, number> = {};
  const displayedPieKeys = new Set(
    pieSliceKeys.filter((key) => key !== PIE_OTHER_SLICE_KEY),
  );
  pieSliceKeys.forEach((key) => {
    pieAttributes[key] =
      key === PIE_OTHER_SLICE_KEY
        ? deriveOtherPieValue(node.attributes, displayedPieKeys)
        : toPositiveNumber(node.attributes?.[key]);
  });
  const hasPieData = Object.values(pieAttributes).some((value) => value > 0);
  const isClusterProxy = node.attributes?.is_cluster_proxy === true;
  const isSelectedNode = node.id === selectedNodeId;
  const nodeType =
    isSelectedNode
      ? SIGMA_NODE_TYPE_BORDER
      : hasPieData && pieSliceKeys.length > 0
      ? SIGMA_NODE_TYPE_PIECHART
      : isClusterProxy
        ? SIGMA_NODE_TYPE_TRIANGLE
        : SIGMA_NODE_TYPE_DEFAULT;
  const nodeSize = node.size ?? SIGMA_DEFAULT_NODE_SIZE;

  graph.addNode(node.id, {
    x: node.x,
    y: node.y,
    size: isSelectedNode ? Math.max(nodeSize * 1.55, nodeSize + 6) : nodeSize,
    label:
      !isSelectedNode &&
      (rendererOptions.label?.enabled === false ||
        rendererOptions.display?.nodeLabels === false)
        ? ""
        : deriveNodeLabel(node.id, node.attributes),
    ...(node.attributes ?? {}),
    ...pieAttributes,
    type: nodeType,
    color: deriveNodeColor(node, selectedNodeId),
    borderColor: isSelectedNode
      ? PHYLOVIZ_NODE_SELECTED_BORDER_COLOR
      : undefined,
    forceLabel: isSelectedNode || undefined,
  });
}

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

export function piechartProgramClasses(
  sliceKeys: readonly string[],
  graph: PositionedGraph | undefined,
  options: SigmaPiechartOptions,
): SigmaNodeProgramClasses {
  if (sliceKeys.length === 0) {
    return {};
  }

  const runtimePalette = resolvePaletteFromGraph(graph);
  const runtimeCategoryColors = resolvePieCategoryColorsFromGraph(graph);
  const palette = buildPiePalette(
    sliceKeys.length,
    runtimePalette ?? options.palette,
  );
  const slices = sliceKeys.map((attributeKey, index) => ({
    color: {
      value:
        attributeKey === PIE_OTHER_SLICE_KEY
          ? PIE_OTHER_SLICE_COLOR
          : runtimeCategoryColors[attributeKey] ?? (palette[index] as string),
    },
    value: { attribute: attributeKey },
  })) as [
    { color: { value: string }; value: { attribute: string } },
    ...Array<{ color: { value: string }; value: { attribute: string } }>,
  ];

  return {
    [SIGMA_NODE_TYPE_PIECHART]: createNodePiechartProgram({
      defaultColor: SIGMA_DEFAULT_NODE_COLOR,
      slices,
    }),
  };
}

export function areStringArraysEqual(
  left: readonly string[],
  right: readonly string[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }

  return true;
}

function toPositiveNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return 0;
  }
  return value;
}

function deriveOtherPieValue(
  attributes: Record<string, unknown> | undefined,
  displayedPieKeys: Set<string>,
): number {
  if (!attributes) {
    return 0;
  }

  return Object.entries(attributes).reduce((sum, [key, value]) => {
    if (
      key === PIE_OTHER_SLICE_KEY ||
      !key.startsWith(PIE_ATTRIBUTE_PREFIX) ||
      displayedPieKeys.has(key)
    ) {
      return sum;
    }

    return sum + toPositiveNumber(value);
  }, 0);
}

function deriveEdgeSize(
  attributes: Record<string, unknown> | undefined,
  rendererOptions: SigmaRendererOptions,
): number {
  const baseSize = rendererOptions.edge?.size ?? SIGMA_DEFAULT_EDGE_SIZE;
  if (rendererOptions.display?.distanceWeightedEdges !== true) {
    return baseSize;
  }

  const distance = toPositiveNumber(attributes?.distance);
  if (distance === 0) {
    return baseSize;
  }

  return baseSize + Math.log1p(distance) * SIGMA_DISTANCE_EDGE_SIZE_FACTOR;
}

function deriveNodeColor(
  node: PositionedNode,
  selectedNodeId?: string | null,
): string {
  if (
    node.id === selectedNodeId ||
    isTruthyAttribute(node.attributes, ["selected", "is_selected"])
  ) {
    return PHYLOVIZ_NODE_SELECTED_COLOR;
  }

  const role = normalizeRoleValue(
    firstAttributeValue(node.attributes, [
      "phyloviz_role",
      "st_role",
      "node_role",
      "role",
      "category",
      "type",
    ]),
  );

  if (
    role === "group_founder" ||
    isTruthyAttribute(node.attributes, [
      "group_founder",
      "is_group_founder",
      "founder",
      "is_founder",
    ])
  ) {
    return PHYLOVIZ_NODE_GROUP_FOUNDER_COLOR;
  }

  if (
    role === "subgroup_founder" ||
    isTruthyAttribute(node.attributes, [
      "subgroup_founder",
      "sub_group_founder",
      "is_subgroup_founder",
      "is_sub_group_founder",
    ])
  ) {
    return PHYLOVIZ_NODE_SUBGROUP_FOUNDER_COLOR;
  }

  return PHYLOVIZ_NODE_COMMON_COLOR;
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
  const channel = Math.round(35 + normalized * 185);
  const hex = channel.toString(16).padStart(2, "0");
  return `#${hex}${hex}${hex}`;
}

function formatDistanceLabel(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "";
  }

  return Number.isInteger(value) ? String(value) : value.toFixed(3);
}

function firstAttributeValue(
  attributes: Record<string, unknown> | undefined,
  keys: readonly string[],
): unknown {
  if (!attributes) {
    return undefined;
  }

  for (const key of keys) {
    const direct = attributes[key];
    if (direct !== undefined && direct !== null) {
      return direct;
    }

    const metadata = attributes.metadata;
    if (metadata && typeof metadata === "object") {
      const metadataValue = (metadata as Record<string, unknown>)[key];
      if (metadataValue !== undefined && metadataValue !== null) {
        return metadataValue;
      }
    }
  }

  return undefined;
}

function isTruthyAttribute(
  attributes: Record<string, unknown> | undefined,
  keys: readonly string[],
): boolean {
  const value = firstAttributeValue(attributes, keys);
  return value === true || value === 1 || normalizeRoleValue(value) === "true";
}

function normalizeRoleValue(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value !== "string") {
    return "";
  }

  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
  if (
    normalized === "sub_group_founder" ||
    normalized === "sub_founder" ||
    normalized === "subgroup"
  ) {
    return "subgroup_founder";
  }
  if (normalized === "group_founder" || normalized === "founder") {
    return "group_founder";
  }
  if (normalized === "common_node") {
    return "common";
  }
  return normalized.replace(/^rule_0?/, "rule_");
}

function resolvePaletteFromGraph(
  graph: PositionedGraph | undefined,
): string[] | undefined {
  if (!graph) {
    return undefined;
  }

  for (const node of graph.nodes) {
    const paletteValue = node.attributes?.[PIE_PALETTE_ATTRIBUTE];
    if (!Array.isArray(paletteValue)) {
      continue;
    }

    const colors = paletteValue.filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    );
    if (colors.length > 0) {
      return colors;
    }
  }

  return undefined;
}

function resolvePieCategoryColorsFromGraph(
  graph: PositionedGraph | undefined,
): Record<string, string> {
  if (!graph) {
    return {};
  }

  for (const node of graph.nodes) {
    const colorValue = node.attributes?.[PIE_CATEGORY_COLORS_ATTRIBUTE];
    if (!colorValue || typeof colorValue !== "object" || Array.isArray(colorValue)) {
      continue;
    }

    return colorValue as Record<string, string>;
  }

  return {};
}

function deriveNodeLabel(
  nodeId: string,
  attributes: Record<string, unknown> | undefined,
): string {
  if (isGeneratedInternalNodeId(nodeId)) {
    return "";
  }

  const explicitLabel = attributes?.label;
  if (typeof explicitLabel === "string" && explicitLabel.trim().length > 0) {
    return explicitLabel.trim();
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

const drawCenteredNodeLabel: NodeLabelDrawingFunction = (
  context,
  data,
  settings,
) => {
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

const drawDistanceEdgeLabel: EdgeLabelDrawingFunction = (
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

function fitLabelToNode(
  context: CanvasRenderingContext2D,
  label: string,
  maxWidth: number,
): string {
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

function isGeneratedInternalNodeId(nodeId: string): boolean {
  return nodeId.startsWith(INTERNAL_NODE_ID_PREFIX);
}
