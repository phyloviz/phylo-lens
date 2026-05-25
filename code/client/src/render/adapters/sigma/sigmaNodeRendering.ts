import { createNodePiechartProgram } from "@sigma/node-piechart";
import type Graph from "graphology";

import type {
  PositionedGraph,
  PositionedNode,
} from "../../../contracts/positioned";
import { buildPiePalette, PIE_PALETTE_ATTRIBUTE } from "../../pieMapping";
import { TriangleNodeProgram } from "../../nodePrograms/triangleNodeProgram";
import {
  SIGMA_MAX_CAMERA_RATIO,
  SIGMA_MIN_CAMERA_RATIO,
  SIGMA_ZOOMING_RATIO,
} from "./sigmaCamera";

export const SIGMA_DEFAULT_NODE_SIZE = 6;
export const SIGMA_DEFAULT_NODE_COLOR = "#0f766e";
export const SIGMA_DEFAULT_EDGE_COLOR = "#94a3b8";
export const SIGMA_DEFAULT_EDGE_SIZE = 1.25;

export const SIGMA_DEFAULT_LABEL_COLOR = "#0f172a";
export const SIGMA_DEFAULT_LABEL_SIZE = 13;
export const SIGMA_DEFAULT_LABEL_DENSITY = 0.9;
export const SIGMA_DEFAULT_LABEL_GRID_CELL_SIZE = 90;
export const SIGMA_DEFAULT_LABEL_RENDERED_SIZE_THRESHOLD = 4;

export const SIGMA_NODE_TYPE_DEFAULT = "circle";
export const SIGMA_NODE_TYPE_TRIANGLE = "triangle";
export const SIGMA_NODE_TYPE_PIECHART = "piechart";

export interface SigmaPiechartOptions {
  enabled?: boolean;
  palette?: string[];
}

export interface SigmaRendererOptions {
  piechart?: SigmaPiechartOptions;
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
  };
}

export type SigmaNodeProgramClasses = Record<string, unknown>;

export function buildSigmaSettings(
  rendererOptions: SigmaRendererOptions,
  nodeProgramClasses: SigmaNodeProgramClasses = {},
): Record<string, unknown> {
  return {
    renderLabels: rendererOptions.label?.enabled !== false,
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
    nodeProgramClasses: {
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
): void {
  const hasPieData = pieSliceKeys.some(
    (key) => toPositiveNumber(node.attributes?.[key]) > 0,
  );
  const isClusterProxy = node.attributes?.is_cluster_proxy === true;
  const nodeType =
    hasPieData && pieSliceKeys.length > 0
      ? SIGMA_NODE_TYPE_PIECHART
      : isClusterProxy
        ? SIGMA_NODE_TYPE_TRIANGLE
        : SIGMA_NODE_TYPE_DEFAULT;

  const pieAttributes: Record<string, number> = {};
  pieSliceKeys.forEach((key) => {
    pieAttributes[key] = toPositiveNumber(node.attributes?.[key]);
  });

  graph.addNode(node.id, {
    x: node.x,
    y: node.y,
    size: node.size ?? SIGMA_DEFAULT_NODE_SIZE,
    color: node.color ?? SIGMA_DEFAULT_NODE_COLOR,
    label:
      rendererOptions.label?.enabled === false
        ? ""
        : deriveNodeLabel(node.id, node.attributes),
    ...(node.attributes ?? {}),
    ...pieAttributes,
    type: nodeType,
  });
}

export function addPositionedEdges(
  graph: Graph,
  positionedGraph: PositionedGraph,
  rendererOptions: SigmaRendererOptions,
): void {
  positionedGraph.edges.forEach((edge) => {
    const sourceExists = graph.hasNode(edge.source);
    const targetExists = graph.hasNode(edge.target);

    if (!sourceExists || !targetExists) {
      return;
    }

    graph.addEdgeWithKey(edge.id, edge.source, edge.target, {
      color: rendererOptions.edge?.color ?? SIGMA_DEFAULT_EDGE_COLOR,
      size: rendererOptions.edge?.size ?? SIGMA_DEFAULT_EDGE_SIZE,
      ...(edge.attributes ?? {}),
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
  const palette = buildPiePalette(
    sliceKeys.length,
    runtimePalette ?? options.palette,
  );
  const slices = sliceKeys.map((attributeKey, index) => ({
    color: { value: palette[index] as string },
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

function deriveNodeLabel(
  nodeId: string,
  attributes: Record<string, unknown> | undefined,
): string {
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
