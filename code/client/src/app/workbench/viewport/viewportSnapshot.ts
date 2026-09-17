import type { AncillaryObservation } from "../../../contracts/ancillary";
import { type AncillaryInputOptions } from "../../../ancillary/ancillaryInput";
import { decodeLegacyMetadata } from "../../../ancillary/legacyMetadata";
import type { GraphViewportEdge, GraphViewportNode, GraphViewportResponse } from "../../../api/graphContracts";
import type { PositionedEdge, PositionedGraph, PositionedNode } from "../../../contracts/positioned";
import { hasActiveFilters, matchesFilterState } from "../../../ancillary/filterEngine";
import type { AncillaryFilterState } from "../../../ancillary/ancillaryTypes";
import type { GraphDisplayOptions } from "../../../render/renderer.types";
import {
  resolveMappingPalette,
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
  pieDistribution,
  pieGroupingForFields,
  PIE_GROUPING_ATTRIBUTE,
  resolvePieCategoryColor,
  type PieCategory,
  type PieCategoryGrouping,
  PIE_DISTRIBUTION_ATTRIBUTE,
  PIE_CATEGORY_COLORS_ATTRIBUTE,
  PIE_PALETTE_ATTRIBUTE,
} from "../../../render/mapping/pieMapping";

export const DEFAULT_GRAPH_VIEWER_NODE_SIZE = 3;
export const GRAPH_VIEWER_REPRESENTATIVE_BASE_SIZE = 3.5;
export const GRAPH_VIEWER_REPRESENTATIVE_LOG_SIZE_FACTOR = 0.55;
export const GRAPH_VIEWER_REPRESENTATIVE_MAX_SIZE = 6;
export const GRAPH_VIEWER_NODE_COLOR = "#64748b";
export const GRAPH_VIEWER_EDGE_COLOR = "#94a3b8";
export const GRAPH_VIEWER_BASE_EDGE_SIZE = 1;
export const GRAPH_VIEWER_TRIANGLE_NODE_TYPE = "triangle";

export interface ViewportSyncSettings extends AncillaryInputOptions {
  visualMapping?: VisualMappingOptions;
  filterState?: AncillaryFilterState;
  displayOptions?: GraphDisplayOptions;
}

interface ResolvedViewportVisuals {
  colorField: string | undefined;
  sizeField: string;
  scale: SizeScale;
  palette: string[];
  categoryColors?: Record<string, string>;
  grouping: PieCategoryGrouping;
  numericStats?: { min: number; max: number };
  customSize: boolean;
  pie?: NonNullable<VisualMappingOptions["pie"]>;
}

export function graphSnapshotFromViewportResponse(
  response: GraphViewportResponse,
  settings?: ViewportSyncSettings,
): PositionedGraph {
  const nodes = filteredViewportNodes(response, settings);
  const visuals = resolveViewportVisuals(nodes, settings);
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

export function graphSnapshotWithDisplayOptions(
  graph: PositionedGraph,
  displayOptions?: GraphDisplayOptions,
): PositionedGraph {
  const showNodeLabel = displayOptions?.nodeLabels !== false;
  const showEdgeLabel = displayOptions?.edgeDistanceLabels === true;
  const distanceWeighted = displayOptions?.distanceWeightedEdges === true;

  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      const attributes = { ...(node.attributes ?? {}) };
      const isRepresentative =
        attributes.is_cluster_proxy === true ||
        attributes.type === GRAPH_VIEWER_TRIANGLE_NODE_TYPE ||
        (typeof attributes.member_count === "number" && attributes.member_count > 1);
      attributes.label = isRepresentative || !showNodeLabel ? "" : node.id;
      return { ...node, attributes };
    }),
    edges: graph.edges.map((edge) => {
      const attributes = { ...(edge.attributes ?? {}) };
      const distance = numberAttribute(attributes.distance);
      const hasDistance = distance !== undefined;
      attributes.size = edgeSizeForDistance(distance, GRAPH_VIEWER_BASE_EDGE_SIZE, distanceWeighted);
      attributes.label = showEdgeLabel && hasDistance ? String(distance) : "";
      attributes.forceLabel = showEdgeLabel;
      return { ...edge, attributes };
    }),
  };
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
  const observations = nodeObservations(node);
  const fields = visuals?.pie?.fields?.length ? visuals.pie.fields : visuals?.colorField ? [visuals.colorField] : [];
  const distribution = pieDistribution(observations, fields);
  // A mixed group has no single category color; keep its solid summary neutral.
  const color =
    visuals && distribution.length === 1
      ? resolvePieCategoryColor(distribution[0], visuals.palette, visuals.categoryColors?.[distribution[0].category])
      : GRAPH_VIEWER_NODE_COLOR;
  const size =
    !isRepresentative &&
    node.isolates?.length &&
    (!visuals?.customSize || (visuals.sizeField === DEFAULT_PROFILE_COUNT_FIELD && visuals.scale === SIZE_SCALE_LINEAR))
      ? DEFAULT_GRAPH_VIEWER_NODE_SIZE * Math.sqrt(node.isolates.length)
      : visuals && visuals.numericStats
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
    annotations: decodeLegacyMetadata(metadata),
    isolates: (node.isolates ?? []).map(({ id, metadata }) => ({ id, ancillaryData: metadata })),
    ancillaryDistribution: observations,
    ...pieNodeAttributes(visuals, distribution),
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
  return response.nodes.flatMap((node) => {
    const observations = nodeObservations(node).filter((row) => matchesFilterState(row.values, filterState));
    return observations.length ? [{ ...node, ancillary_distribution: observations }] : [];
  });
}

function resolveViewportVisuals(
  nodes: GraphViewportNode[],
  settings?: ViewportSyncSettings,
): ResolvedViewportVisuals | null {
  const mapping = settings?.visualMapping;
  if (!mapping) {
    return null;
  }

  const colorField = resolveColorField(mapping.colorField);
  const sizeField = mapping.size?.field ?? mapping.sizeField ?? resolveDefaultSizeField(viewportHasProfileCount(nodes));
  const scale = mapping.size?.scale ?? SIZE_SCALE_LINEAR;
  const palette = resolveMappingPalette(mapping);
  const numericStats = computeSizeFieldStats(nodes, sizeField);
  const pie = mapping.pie && mapping.pie.enabled !== false ? mapping.pie : undefined;

  return {
    colorField,
    customSize: mapping.size !== undefined || mapping.sizeField !== undefined,
    sizeField,
    scale,
    palette,
    categoryColors: mapping.pie?.categoryColors,
    grouping: pieGroupingForFields(mapping.pie?.fields ?? [], mapping.pie?.categoryGrouping),
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

function nodeObservations(node: GraphViewportNode): AncillaryObservation[] {
  if (node.ancillary_distribution?.length) return node.ancillary_distribution;
  if (node.isolates?.length) return node.isolates.map((isolate) => ({ values: isolate.metadata, count: 1 }));
  const annotations = decodeLegacyMetadata(node.metadata ?? {});
  return [{ values: { ...annotations.ancillarySummary.values, ...annotations.ancillaryData }, count: 1 }];
}

function pieNodeAttributes(
  visuals: ResolvedViewportVisuals | null,
  distribution: PieCategory[],
): Record<string, unknown> {
  const pie = visuals?.pie;
  if (!visuals || !pie?.fields?.length) return {};
  const colors = Object.fromEntries(
    distribution.flatMap((slice) => {
      const color = pie.categoryColors?.[slice.category];
      return color && /^#[0-9a-fA-F]{6}$/.test(color) ? [[slice.key, color]] : [];
    }),
  );
  return {
    ...Object.fromEntries(distribution.map((slice) => [slice.key, slice.value])),
    [PIE_DISTRIBUTION_ATTRIBUTE]: distribution,
    [PIE_GROUPING_ATTRIBUTE]: visuals.grouping,
    [PIE_CATEGORY_COLORS_ATTRIBUTE]: colors,
    [PIE_PALETTE_ATTRIBUTE]: visuals.palette,
  };
}

function edgeSizeForDistance(distance: number | null | undefined, baseSize: number, distanceWeighted: boolean): number {
  if (!distanceWeighted || typeof distance !== "number" || !Number.isFinite(distance) || distance <= 0) {
    return baseSize;
  }
  return baseSize + Math.log1p(distance) * 0.75;
}

function numberAttribute(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringAttribute(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
