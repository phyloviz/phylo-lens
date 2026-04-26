import { CanonicalDataset } from "../contracts/canonical";
import { PositionedGraph, PositionedNode } from "../contracts/positioned";
import { MetadataIndexData, getNodeMetadata } from "../ancillary/metadataIndex";
import {
  buildPieAttributes,
  PieMappingOptions,
  PIE_PALETTE_ATTRIBUTE,
} from "./pieMapping";

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

export const DEFAULT_NODE_SIZE = 6;
export const MIN_NODE_SIZE = 4;
export const MAX_NODE_SIZE = 14;
export const CLUSTER_PROXY_MIN_SIZE = 7;
export const CLUSTER_PROXY_MAX_SIZE = 12;

export const DEFAULT_COLOR_FIELD = "region";
export const DEFAULT_SIZE_FIELD = "distance";

export const DEFAULT_PIE_MAPPING: PieMappingOptions = {
  enabled: true,
};

export interface VisualMappingOptions {
  colorField?: string;
  sizeField?: string;
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
  const colorField = options.colorField ?? DEFAULT_COLOR_FIELD;
  const sizeField = options.sizeField ?? DEFAULT_SIZE_FIELD;
  const palette = options.palette ?? DEFAULT_COLOR_PALETTE;
  const pieOptions = options.pie ?? DEFAULT_PIE_MAPPING;

  const mappedNodes = graph.nodes.map((node) =>
    mapNodeVisuals(
      node,
      dataset,
      metadataIndex,
      colorField,
      sizeField,
      palette,
      pieOptions,
    ),
  );

  return {
    ...graph,
    nodes: mappedNodes,
  };
}

// Map one positioned node to metadata-aware color, size, and attributes.
function mapNodeVisuals(
  node: PositionedNode,
  dataset: CanonicalDataset,
  metadataIndex: MetadataIndexData,
  colorField: string,
  sizeField: string,
  palette: string[],
  pieOptions: PieMappingOptions,
): PositionedNode {
  const metadata = getNodeMetadata(metadataIndex, node.id);
  const baseColor = deriveColor(metadata[colorField], palette);
  const baseSize = deriveSize(
    metadata[sizeField],
    metadataIndex.numericStats.get(sizeField),
  );
  const isClusterProxy = node.attributes?.is_cluster_proxy === true;
  const proxySize = deriveClusterProxySize(
    node.attributes?.subtree_size,
    node.attributes?.leaf_count,
  );
  const color = isClusterProxy ? CLUSTER_PROXY_COLOR : baseColor;
  const size = isClusterProxy ? Math.max(baseSize, proxySize) : baseSize;

  return {
    ...node,
    color,
    size,
    attributes: {
      ...(node.attributes ?? {}),
      metadata,
      dataset_id: dataset.dataset_id,
      is_cluster_proxy: isClusterProxy,
      ...buildPieAttributes(metadata, pieOptions, [sizeField]),
      ...(pieOptions.palette && pieOptions.palette.length > 0
        ? { [PIE_PALETTE_ATTRIBUTE]: pieOptions.palette }
        : {}),
    },
  };
}

// Derive deterministic color from categorical metadata values.
function deriveColor(
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
function deriveSize(
  rawValue: string | number | boolean | null | undefined,
  stats: { min: number; max: number } | undefined,
): number {
  if (typeof rawValue !== "number" || !stats) {
    return DEFAULT_NODE_SIZE;
  }

  if (stats.max === stats.min) {
    return DEFAULT_NODE_SIZE;
  }

  const normalized = (rawValue - stats.min) / (stats.max - stats.min);
  return MIN_NODE_SIZE + normalized * (MAX_NODE_SIZE - MIN_NODE_SIZE);
}

function deriveClusterProxySize(
  subtreeSize: unknown,
  leafCount: unknown,
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

  const normalized = Math.min(1, Math.log10(sizeValue + 1) / 3);
  return (
    CLUSTER_PROXY_MIN_SIZE +
    normalized * (CLUSTER_PROXY_MAX_SIZE - CLUSTER_PROXY_MIN_SIZE)
  );
}
