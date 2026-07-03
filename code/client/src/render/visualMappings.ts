import type { CanonicalDataset, MetadataField } from "../contracts/models";
import type { PositionedGraph, PositionedNode } from "../contracts/positioned";
import { getNodeMetadata } from "../ancillary/metadataIndex";
import type { MetadataIndexData } from "../ancillary/metadataIndex";
import {
  buildPieAttributes,
  buildPieCategoryColorAttributes,
  isCategoryCountMetadataKey,
  PIE_CATEGORY_COLORS_ATTRIBUTE,
  PIE_PALETTE_ATTRIBUTE,
} from "./pieMapping";
import type { PieMappingOptions } from "./pieMapping";
import {
  isPhyloVizUnionNode,
  PHYLOVIZ_UNION_NODE_COLOR,
  PHYLOVIZ_UNION_NODE_SIZE,
} from "./phylovizNodes";

export {
  PHYLOVIZ_UNION_NODE_COLOR,
  PHYLOVIZ_UNION_NODE_SIZE,
} from "./phylovizNodes";

export const DEFAULT_COLOR_PALETTE = [
  "#0f766e",
  "#0ea5e9",
  "#f59e0b",
  "#8b5cf6",
  "#ef4444",
  "#14b8a6",
  "#f97316",
  "#84cc16",
];
export const DEFAULT_FALLBACK_COLOR = "#0f766e";
export const CLUSTER_PROXY_COLOR = "#b45309";

export const DEFAULT_NODE_SIZE = 5;
export const MIN_NODE_SIZE = 3;
export const MAX_NODE_SIZE = 10;
export const CLUSTER_PROXY_MIN_SIZE = 6;
export const CLUSTER_PROXY_MAX_SIZE = 10;

export const DEFAULT_COLOR_FIELD = "region";
export const DEFAULT_SIZE_FIELD = "distance";
export const DEFAULT_PROFILE_COUNT_FIELD = "profile_count";
export const SIZE_SCALE_LINEAR = "linear";
export const SIZE_SCALE_LOG = "log";

export const DEFAULT_PIE_MAPPING: PieMappingOptions = {
  enabled: true,
};

export type SizeScale =
  | typeof SIZE_SCALE_LINEAR
  | typeof SIZE_SCALE_LOG;

export interface SizeMappingOptions {
  field?: string;
  scale?: SizeScale;
}

export interface VisualMappingOptions {
  colorField?: string;
  sizeField?: string;
  size?: SizeMappingOptions;
  palette?: string[];
  pie?: PieMappingOptions;
}

// Apply metadata-driven visual attributes while preserving graph topology.
export function applyVisualMappings(
  graph: PositionedGraph,
  dataset: CanonicalDataset,
  metadataIndex: MetadataIndexData,
  options: VisualMappingOptions = {},
): PositionedGraph {
  const colorField = resolveColorField(dataset.metadata_schema, options.colorField);
  const sizeField =
    options.size?.field ?? options.sizeField ?? DEFAULT_SIZE_FIELD;
  const sizeScale = options.size?.scale ?? SIZE_SCALE_LINEAR;
  const palette = options.palette ?? DEFAULT_COLOR_PALETTE;
  const pieOptions = options.pie ?? DEFAULT_PIE_MAPPING;

  const mappedNodes = graph.nodes.map((node) =>
    mapNodeVisuals(
      node,
      dataset,
      metadataIndex,
      colorField,
      sizeField,
      sizeScale,
      palette,
      pieOptions,
    ),
  );

  return {
    ...graph,
    nodes: mappedNodes,
  };
}

export function resolveColorField(
  metadataSchema: MetadataField[],
  requestedColorField: string | undefined,
): string {
  if (requestedColorField) {
    return requestedColorField;
  }

  const schemaKeys = new Set(metadataSchema.map((field) => field.key));
  if (schemaKeys.has(DEFAULT_COLOR_FIELD)) {
    return DEFAULT_COLOR_FIELD;
  }

  const fallbackField = metadataSchema.find(
    (field) =>
      field.type !== "number" &&
      field.type !== "null" &&
      field.key !== DEFAULT_PROFILE_COUNT_FIELD &&
      !isCategoryCountMetadataKey(field.key),
  );

  return fallbackField?.key ?? DEFAULT_COLOR_FIELD;
}

// Map one positioned node to metadata-aware color, size, and attributes.
function mapNodeVisuals(
  node: PositionedNode,
  dataset: CanonicalDataset,
  metadataIndex: MetadataIndexData,
  colorField: string,
  sizeField: string,
  sizeScale: SizeScale,
  palette: string[],
  pieOptions: PieMappingOptions,
): PositionedNode {
  if (isPhyloVizUnionNode(node.id, node.attributes)) {
    return {
      ...node,
      color: PHYLOVIZ_UNION_NODE_COLOR,
      size: PHYLOVIZ_UNION_NODE_SIZE,
      attributes: {
        ...(node.attributes ?? {}),
        dataset_id: dataset.dataset_id,
        is_union_node: true,
      },
    };
  }

  const metadata = getNodeMetadata(metadataIndex, node.id);
  const ancillaryRows = dataset.ancillary_rows_by_node_id?.[node.id] ?? [];
  const baseColor = deriveColor(metadata[colorField], palette);
  const baseSize = deriveSize(
    metadata[sizeField],
    metadataIndex.numericStats.get(sizeField),
    sizeScale,
  );
  const isClusterProxy = node.attributes?.is_cluster_proxy === true;
  const proxySize = deriveClusterProxySize(
    node.attributes?.subtree_size,
    node.attributes?.leaf_count,
    sizeScale,
  );
  const color = isClusterProxy ? CLUSTER_PROXY_COLOR : baseColor;
  const size = isClusterProxy ? Math.max(baseSize, proxySize) : baseSize;
  const pieCategoryColors = buildPieCategoryColorAttributes(
    metadata,
    pieOptions,
    [sizeField],
    ancillaryRows,
  );

  return {
    ...node,
    color,
    size,
    attributes: {
      ...(node.attributes ?? {}),
      metadata,
      dataset_id: dataset.dataset_id,
      is_cluster_proxy: isClusterProxy,
      ...buildPieAttributes(metadata, pieOptions, [sizeField], ancillaryRows),
      ...(Object.keys(pieCategoryColors).length > 0
        ? { [PIE_CATEGORY_COLORS_ATTRIBUTE]: pieCategoryColors }
        : {}),
      ...(pieOptions.palette && pieOptions.palette.length > 0
        ? { [PIE_PALETTE_ATTRIBUTE]: pieOptions.palette }
        : {}),
    },
  };
}

// Derive deterministic color from categorical metadata values.
export function deriveColor(
  rawValue: string | number | boolean | null | undefined,
  palette: string[],
): string {
  if (rawValue === undefined || rawValue === null || palette.length === 0) {
    return DEFAULT_FALLBACK_COLOR;
  }

  const value = String(rawValue);
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  const paletteIndex = hash % palette.length;
  return palette[paletteIndex] ?? DEFAULT_FALLBACK_COLOR;
}

// Derive node size from numeric metadata using min-max normalization.
export function deriveSize(
  rawValue: string | number | boolean | null | undefined,
  stats: { min: number; max: number } | undefined,
  scale: SizeScale,
): number {
  if (typeof rawValue !== "number" || !stats) {
    return DEFAULT_NODE_SIZE;
  }

  return scaleNumberToRange(
    rawValue,
    stats.min,
    stats.max,
    MIN_NODE_SIZE,
    MAX_NODE_SIZE,
    scale,
    DEFAULT_NODE_SIZE,
  );
}

function deriveClusterProxySize(
  subtreeSize: unknown,
  leafCount: unknown,
  scale: SizeScale,
): number {
  const sizeValue =
    typeof leafCount === "number" && leafCount > 0
      ? leafCount
      : typeof subtreeSize === "number" && subtreeSize > 0
        ? subtreeSize
        : null;
  if (sizeValue === null) {
    return CLUSTER_PROXY_MIN_SIZE;
  }

  return scaleNumberToRange(
    sizeValue,
    1,
    100,
    CLUSTER_PROXY_MIN_SIZE,
    CLUSTER_PROXY_MAX_SIZE,
    scale,
    CLUSTER_PROXY_MIN_SIZE,
  );
}

function scaleNumberToRange(
  value: number,
  min: number,
  max: number,
  outputMin: number,
  outputMax: number,
  scale: SizeScale,
  fallback: number,
): number {
  if (!Number.isFinite(value) || max === min) {
    return fallback;
  }

  const normalized =
    scale === SIZE_SCALE_LOG
      ? normalizeLogValue(value, min, max)
      : (value - min) / (max - min);
  const clamped = Math.min(1, Math.max(0, normalized));
  return outputMin + clamped * (outputMax - outputMin);
}

function normalizeLogValue(value: number, min: number, max: number): number {
  const safeMin = Math.max(0, min);
  const safeMax = Math.max(0, max);
  if (safeMax === safeMin) {
    return 0;
  }

  const transformedValue = Math.log1p(Math.max(0, value));
  const transformedMin = Math.log1p(safeMin);
  const transformedMax = Math.log1p(safeMax);
  return (transformedValue - transformedMin) / (transformedMax - transformedMin);
}
