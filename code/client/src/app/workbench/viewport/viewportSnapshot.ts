import type {
  GraphMetadataValue,
  GraphViewportEdge,
  GraphViewportNode,
  GraphViewportResponse,
} from "../../../api/graphContracts";
import type { MetadataField } from "../../../contracts/models";
import type { PositionedEdge, PositionedGraph, PositionedNode } from "../../../contracts/positioned";
import { hasActiveFilters, matchesFilterState } from "../../../ancillary/filterEngine";
import type { MetadataFilterState } from "../../../ancillary/metadataTypes";
import type { GraphDisplayOptions } from "../../../render/renderer.types";
import {
  buildValueColorMap,
  DEFAULT_COLOR_PALETTE,
  DEFAULT_PROFILE_COUNT_FIELD,
  deriveSize,
  numericMetadataValue,
  resolveColorField,
  resolveDefaultSizeField,
  SIZE_SCALE_LINEAR,
  type SizeScale,
  type VisualMappingOptions,
} from "../../../render/mapping/visualMapping";
import {
  buildPieAttributes,
  buildPieCategoryColorAttributes,
  PIE_CATEGORY_COLORS_ATTRIBUTE,
  PIE_PALETTE_ATTRIBUTE,
} from "../../../render/mapping/pieMapping";

export const DEFAULT_GRAPH_VIEWER_NODE_SIZE = 3;
export const GRAPH_VIEWER_REPRESENTATIVE_BASE_SIZE = 3.5;
export const GRAPH_VIEWER_REPRESENTATIVE_LOG_SIZE_FACTOR = 0.55;
export const GRAPH_VIEWER_REPRESENTATIVE_MAX_SIZE = 6;
export const GRAPH_VIEWER_REPRESENTATIVE_COLOR = "#b45309";
export const GRAPH_VIEWER_NODE_COLOR = "#93c5fd";
export const GRAPH_VIEWER_EDGE_COLOR = "#94a3b8";
export const GRAPH_VIEWER_BASE_EDGE_SIZE = 1;
export const GRAPH_VIEWER_TRIANGLE_NODE_TYPE = "triangle";

export interface ViewportSyncSettings {
  visualMapping?: VisualMappingOptions;
  filterState?: MetadataFilterState;
  metadataSchema?: MetadataField[];
  displayOptions?: GraphDisplayOptions;
}

interface ResolvedViewportVisuals {
  colorField: string;
  sizeField: string;
  scale: SizeScale;
  palette: readonly string[];
  colorForValue: (value: GraphMetadataValue | undefined) => string;
  numericStats?: { min: number; max: number };
  pie?: NonNullable<VisualMappingOptions["pie"]>;
}

export function graphSnapshotFromViewportResponse(
  response: GraphViewportResponse,
  settings?: ViewportSyncSettings,
): PositionedGraph {
  const nodes = filteredViewportNodes(response, settings);
  const visuals = resolveViewportVisuals(nodes, response.metadata_schema ?? [], settings);
  const liveNodeIds = new Set(nodes.map((node) => node.id));
  const displayOptions = settings?.displayOptions;

  return {
    nodes: nodes.map((node) => positionedNodeFromViewportNode(node, visuals, displayOptions)),
    edges: response.edges
      .filter((edge) => liveNodeIds.has(edge.source) && liveNodeIds.has(edge.target))
      .map((edge) => positionedEdgeFromViewportEdge(edge, displayOptions)),
    viewMeta: {
      layout: "server",
      lodLevel: response.lod_level ?? 0,
      sliceNodeCount: nodes.length,
      sliceEdgeCount: response.edges.length,
      zoom: response.zoom,
      layoutStatus: response.layout_status,
      globalBounds: response.global_bounds
        ? {
            minX: response.global_bounds.min_x,
            maxX: response.global_bounds.max_x,
            minY: response.global_bounds.min_y,
            maxY: response.global_bounds.max_y,
          }
        : undefined,
    },
  };
}

export function mergeGraphSnapshots(base: PositionedGraph, patch: PositionedGraph): PositionedGraph {
  const nodes = new Map(base.nodes.map((node) => [node.id, node]));
  const edges = new Map(base.edges.map((edge) => [edge.id, edge]));
  patch.nodes.forEach((node) => nodes.set(node.id, node));
  patch.edges.forEach((edge) => edges.set(edge.id, edge));
  return {
    nodes: Array.from(nodes.values()),
    edges: Array.from(edges.values()).filter((edge) => nodes.has(edge.source) && nodes.has(edge.target)),
    viewMeta: patch.viewMeta,
  };
}

export function isExpandableRepresentative(attributes: Record<string, unknown> | undefined): boolean {
  return (
    attributes?.type === GRAPH_VIEWER_TRIANGLE_NODE_TYPE ||
    attributes?.is_cluster_proxy === true ||
    (typeof attributes?.member_count === "number" && attributes.member_count > 1)
  );
}

function positionedNodeFromViewportNode(
  node: GraphViewportNode,
  visuals: ResolvedViewportVisuals | null,
  displayOptions?: GraphDisplayOptions,
): PositionedNode {
  const attributes = buildGraphViewportNodeAttributes(node, visuals, displayOptions);
  return {
    id: node.id,
    x: node.x,
    y: node.y,
    size: numberAttribute(attributes.size),
    color: stringAttribute(attributes.color),
    attributes,
  };
}

function positionedEdgeFromViewportEdge(edge: GraphViewportEdge, displayOptions?: GraphDisplayOptions): PositionedEdge {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    attributes: buildGraphViewportEdgeAttributes(edge, displayOptions),
  };
}

function buildGraphViewportNodeAttributes(
  node: GraphViewportNode,
  visuals: ResolvedViewportVisuals | null,
  displayOptions?: GraphDisplayOptions,
): Record<string, unknown> {
  const isRepresentative = node.member_count > 1;
  const metadata = node.metadata ?? undefined;
  const mappedValue = visuals ? metadata?.[visuals.colorField] : undefined;
  const hasMappedValue = mappedValue !== undefined && mappedValue !== null && mappedValue !== "";
  const roleColor = isRepresentative ? GRAPH_VIEWER_REPRESENTATIVE_COLOR : deriveViewportNodeColor(node);
  const color = visuals && hasMappedValue ? visuals.colorForValue(mappedValue) : roleColor;
  const size =
    visuals && visuals.numericStats
      ? deriveSize(metadata?.[visuals.sizeField], visuals.numericStats, visuals.scale)
      : nodeSizeForMemberCount(node.member_count);
  const showNodeLabel = displayOptions?.nodeLabels !== false;
  return {
    x: node.x,
    y: node.y,
    size,
    label: isRepresentative || !showNodeLabel ? "" : node.id,
    color,
    cluster_id: node.cluster_id,
    member_count: node.member_count,
    is_cluster_proxy: isRepresentative || undefined,
    type: isRepresentative ? GRAPH_VIEWER_TRIANGLE_NODE_TYPE : undefined,
    borderColor: undefined,
    layout_status: node.layout_status,
    ...(metadata ? { metadata } : {}),
    ...pieNodeAttributes(metadata, visuals),
  };
}

function buildGraphViewportEdgeAttributes(
  edge: GraphViewportEdge,
  displayOptions?: GraphDisplayOptions,
): Record<string, unknown> {
  const isMeta = edge.is_meta === true;
  const hasDistance = typeof edge.distance === "number" && Number.isFinite(edge.distance);
  const showEdgeLabel = displayOptions?.edgeDistanceLabels === true;
  return {
    color: GRAPH_VIEWER_EDGE_COLOR,
    size: edgeSizeForDistance(
      edge.distance,
      GRAPH_VIEWER_BASE_EDGE_SIZE,
      displayOptions?.distanceWeightedEdges === true,
    ),
    distance: edge.distance ?? undefined,
    label: showEdgeLabel && hasDistance ? String(edge.distance) : "",
    forceLabel: showEdgeLabel,
    isMeta,
    bundledEdgeCount: isMeta ? (edge.bundled_edge_count ?? 1) : undefined,
  };
}

function filteredViewportNodes(response: GraphViewportResponse, settings?: ViewportSyncSettings): GraphViewportNode[] {
  const filterState = settings?.filterState;
  if (!filterState || !hasActiveFilters(filterState)) {
    return response.nodes;
  }
  return response.nodes.filter((node) => matchesFilterState(node.metadata, filterState));
}

function resolveViewportVisuals(
  nodes: GraphViewportNode[],
  responseMetadataSchema: MetadataField[],
  settings?: ViewportSyncSettings,
): ResolvedViewportVisuals | null {
  const mapping = settings?.visualMapping;
  if (!mapping) {
    return null;
  }

  const metadataSchema = responseMetadataSchema.length > 0 ? responseMetadataSchema : (settings?.metadataSchema ?? []);
  const colorField = resolveColorField(metadataSchema, mapping.colorField);
  const sizeField = mapping.size?.field ?? mapping.sizeField ?? resolveDefaultSizeField(viewportHasProfileCount(nodes));
  const scale = mapping.size?.scale ?? SIZE_SCALE_LINEAR;
  const palette = mapping.palette ?? DEFAULT_COLOR_PALETTE;
  const numericStats = computeSizeFieldStats(nodes, sizeField);
  const colorForValue = buildValueColorMap(
    nodes.map((node) => node.metadata?.[colorField]),
    palette,
  );
  const pie = mapping.pie && mapping.pie.enabled !== false ? mapping.pie : undefined;

  return {
    colorField,
    sizeField,
    scale,
    palette,
    colorForValue,
    numericStats,
    pie,
  };
}

function viewportHasProfileCount(nodes: GraphViewportNode[]): boolean {
  return nodes.some((node) => typeof node.metadata?.[DEFAULT_PROFILE_COUNT_FIELD] === "number");
}

function computeSizeFieldStats(
  nodes: GraphViewportNode[],
  sizeField: string,
): { min: number; max: number } | undefined {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  nodes.forEach((node) => {
    const value = numericMetadataValue(node.metadata?.[sizeField]);
    if (value === null) {
      return;
    }
    min = Math.min(min, value);
    max = Math.max(max, value);
  });

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return undefined;
  }
  return { min, max };
}

function nodeSizeForMemberCount(memberCount: number): number {
  const safeMemberCount = Math.max(1, memberCount);
  if (safeMemberCount === 1) {
    return DEFAULT_GRAPH_VIEWER_NODE_SIZE;
  }
  const boost = Math.log2(safeMemberCount) * GRAPH_VIEWER_REPRESENTATIVE_LOG_SIZE_FACTOR;
  return Math.min(GRAPH_VIEWER_REPRESENTATIVE_MAX_SIZE, GRAPH_VIEWER_REPRESENTATIVE_BASE_SIZE + boost);
}

function deriveViewportNodeColor(node: GraphViewportNode): string {
  const metadata = node.metadata ?? undefined;
  if (isTruthyMetadata(metadata, ["selected", "is_selected"])) {
    return "#dc2626";
  }
  const role = normalizeRoleValue(firstMetadataValue(metadata, ["phyloviz_role", "st_role", "node_role", "role"]));
  if (
    role === "group_founder" ||
    isTruthyMetadata(metadata, ["group_founder", "is_group_founder", "founder", "is_founder"])
  ) {
    return "#86efac";
  }
  if (
    role === "subgroup_founder" ||
    isTruthyMetadata(metadata, ["subgroup_founder", "sub_group_founder", "is_subgroup_founder", "is_sub_group_founder"])
  ) {
    return "#15803d";
  }
  return GRAPH_VIEWER_NODE_COLOR;
}

function pieNodeAttributes(
  metadata: Record<string, GraphMetadataValue> | undefined,
  visuals: ResolvedViewportVisuals | null,
): Record<string, unknown> {
  const pie = visuals?.pie;
  if (!pie || !metadata) {
    return {};
  }

  const excludedFields = [visuals.sizeField];
  const pieAttributes = buildPieAttributes(metadata, pie, excludedFields, []);
  const pieCategoryColors = buildPieCategoryColorAttributes(metadata, pie, excludedFields, []);

  return {
    ...pieAttributes,
    ...(Object.keys(pieCategoryColors).length > 0 ? { [PIE_CATEGORY_COLORS_ATTRIBUTE]: pieCategoryColors } : {}),
    ...(pie.palette && pie.palette.length > 0 ? { [PIE_PALETTE_ATTRIBUTE]: pie.palette } : {}),
  };
}

function edgeSizeForDistance(distance: number | null | undefined, baseSize: number, distanceWeighted: boolean): number {
  if (!distanceWeighted || typeof distance !== "number" || !Number.isFinite(distance) || distance <= 0) {
    return baseSize;
  }
  return baseSize + Math.log1p(distance) * 0.75;
}

function firstMetadataValue(
  metadata: Record<string, GraphMetadataValue> | undefined,
  keys: readonly string[],
): GraphMetadataValue | undefined {
  return keys.map((key) => metadata?.[key]).find((value) => value !== undefined);
}

function isTruthyMetadata(metadata: Record<string, GraphMetadataValue> | undefined, keys: readonly string[]): boolean {
  return keys.some((key) => {
    const value = metadata?.[key];
    return (
      value === true ||
      value === 1 ||
      (typeof value === "string" && ["true", "1", "yes", "y"].includes(value.toLowerCase()))
    );
  });
}

function normalizeRoleValue(value: GraphMetadataValue | undefined): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function numberAttribute(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringAttribute(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
