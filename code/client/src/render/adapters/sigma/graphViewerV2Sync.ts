import type Graph from "graphology";

import type {
  GraphV2MetadataValue,
  GraphV2ViewportEdge,
  GraphV2ViewportNode,
  GraphV2ViewportResponse,
} from "../../../api/graphV2Client";
import type { MetadataField } from "../../../contracts/models";
import {
  hasActiveFilters,
  matchesFilterState,
  type MetadataFilterState,
} from "../../../ancillary/filterEngine";
import {
  DEFAULT_COLOR_PALETTE,
  DEFAULT_SIZE_FIELD,
  deriveColor,
  deriveSize,
  resolveColorField,
  SIZE_SCALE_LINEAR,
  type SizeScale,
  type VisualMappingOptions,
} from "../../visualMappings";
import {
  buildPieAttributes,
  buildPieCategoryColorAttributes,
  PIE_CATEGORY_COLORS_ATTRIBUTE,
  PIE_PALETTE_ATTRIBUTE,
} from "../../pieMapping";
import type { PieMappingOptions } from "../../pieMapping";
import {
  PHYLOVIZ_NODE_COMMON_COLOR,
  SIGMA_NODE_TYPE_TRIANGLE,
} from "./sigmaRenderingConstants";

export const DEFAULT_GRAPH_VIEWER_V2_NODE_SIZE = 5;
export const GRAPH_VIEWER_V2_MEMBER_SIZE_FACTOR = 1.25;
export const GRAPH_VIEWER_V2_MAX_MEMBER_SIZE_BOOST = 6;
export const GRAPH_VIEWER_V2_REPRESENTATIVE_COLOR = "#b45309";
export const GRAPH_VIEWER_V2_NODE_COLOR = PHYLOVIZ_NODE_COMMON_COLOR;
export const GRAPH_VIEWER_V2_EDGE_COLOR = "#94a3b8";

// Metadata-driven color/size + filter settings applied while syncing a viewport.
export interface ViewportSyncSettings {
  visualMapping?: VisualMappingOptions;
  filterState?: MetadataFilterState;
  metadataSchema?: MetadataField[];
}

// Resolved per-viewport color/size parameters when a visual mapping is active.
interface ResolvedViewportVisuals {
  colorField: string;
  sizeField: string;
  scale: SizeScale;
  palette: string[];
  numericStats?: { min: number; max: number };
  // Present only when an explicit pie mapping is active for this viewport.
  pie?: PieMappingOptions;
}

export function syncGraphologyViewport(
  graph: Graph,
  response: GraphV2ViewportResponse,
  settings?: ViewportSyncSettings,
): void {
  const nodes = filteredViewportNodes(response, settings);
  const visuals = resolveViewportVisuals(nodes, settings);
  const liveNodeIds = new Set(nodes.map((node) => node.id));
  nodes.forEach((node) => upsertGraphNode(graph, node, visuals));
  response.edges.forEach((edge) => {
    if (!liveNodeIds.has(edge.source) || !liveNodeIds.has(edge.target)) {
      return;
    }
    upsertGraphEdge(graph, edge);
  });
}

export function reconcileGraphologyViewport(
  graph: Graph,
  response: GraphV2ViewportResponse,
  settings?: ViewportSyncSettings,
): void {
  const nodes = filteredViewportNodes(response, settings);
  const liveNodeIds = new Set(nodes.map((node) => node.id));
  graph.nodes().forEach((nodeId) => {
    if (!liveNodeIds.has(nodeId)) {
      graph.dropNode(nodeId);
    }
  });

  const liveEdgeIds = new Set(response.edges.map((edge) => edge.id));
  graph.edges().forEach((edgeId) => {
    if (!liveEdgeIds.has(edgeId)) {
      graph.dropEdge(edgeId);
    }
  });
}

// Restrict a viewport response to nodes passing the active metadata filters.
function filteredViewportNodes(
  response: GraphV2ViewportResponse,
  settings?: ViewportSyncSettings,
): GraphV2ViewportNode[] {
  const filterState = settings?.filterState;
  if (!filterState || !hasActiveFilters(filterState)) {
    return response.nodes;
  }
  return response.nodes.filter((node) =>
    matchesFilterState(node.metadata, filterState),
  );
}

// Resolve color/size parameters once per viewport when a mapping is active.
function resolveViewportVisuals(
  nodes: GraphV2ViewportNode[],
  settings?: ViewportSyncSettings,
): ResolvedViewportVisuals | null {
  const mapping = settings?.visualMapping;
  if (!mapping) {
    return null;
  }

  const colorField = resolveColorField(
    settings?.metadataSchema ?? [],
    mapping.colorField,
  );
  const sizeField = mapping.size?.field ?? mapping.sizeField ?? DEFAULT_SIZE_FIELD;
  const scale = mapping.size?.scale ?? SIZE_SCALE_LINEAR;
  const palette = mapping.palette ?? DEFAULT_COLOR_PALETTE;
  const numericStats = computeSizeFieldStats(nodes, sizeField);
  // Pie is opt-in under LoD: only when an explicit, enabled pie mapping is set.
  const pie =
    mapping.pie && mapping.pie.enabled !== false ? mapping.pie : undefined;

  return { colorField, sizeField, scale, palette, numericStats, pie };
}

// Compute min/max for the active size field across the current viewport nodes.
function computeSizeFieldStats(
  nodes: GraphV2ViewportNode[],
  sizeField: string,
): { min: number; max: number } | undefined {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  nodes.forEach((node) => {
    const value = node.metadata?.[sizeField];
    if (typeof value !== "number") {
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

export function nodeSizeForMemberCount(memberCount: number): number {
  const safeMemberCount = Math.max(1, memberCount);
  const boost = Math.min(
    GRAPH_VIEWER_V2_MAX_MEMBER_SIZE_BOOST,
    (Math.sqrt(safeMemberCount) - 1) * GRAPH_VIEWER_V2_MEMBER_SIZE_FACTOR,
  );
  return DEFAULT_GRAPH_VIEWER_V2_NODE_SIZE + boost;
}

export function isExpandableRepresentative(
  attributes: Record<string, unknown>,
): boolean {
  return (
    attributes.type === SIGMA_NODE_TYPE_TRIANGLE ||
    attributes.is_cluster_proxy === true ||
    (typeof attributes.member_count === "number" && attributes.member_count > 1)
  );
}

function upsertGraphNode(
  graph: Graph,
  node: GraphV2ViewportNode,
  visuals: ResolvedViewportVisuals | null,
): void {
  const attributes = graphNodeAttributes(node, visuals);
  if (!graph.hasNode(node.id)) {
    graph.addNode(node.id, attributes);
    return;
  }

  // Write only the attributes whose value actually changed, in a single merge.
  // The previous per-key setNodeAttribute loop emitted one graphology update
  // event per attribute (~13 per node), each waking Sigma's re-index/render;
  // one merge of the changed subset collapses that to a single event and skips
  // the write entirely when a node's visible attributes are unchanged.
  const existing = graph.getNodeAttributes(node.id);
  const changed: Record<string, unknown> = {};
  Object.entries(attributes).forEach(([key, value]) => {
    if (existing[key] !== value) {
      changed[key] = value;
    }
  });
  if (Object.keys(changed).length > 0) {
    graph.mergeNodeAttributes(node.id, changed);
  }
}

function upsertGraphEdge(graph: Graph, edge: GraphV2ViewportEdge): void {
  if (!graph.hasNode(edge.source) || !graph.hasNode(edge.target)) {
    return;
  }
  const attributes = graphEdgeAttributes(edge);
  if (!graph.hasEdge(edge.id)) {
    graph.addEdgeWithKey(edge.id, edge.source, edge.target, attributes);
    return;
  }
  Object.entries(attributes).forEach(([key, value]) => {
    graph.setEdgeAttribute(edge.id, key, value);
  });
}

function graphNodeAttributes(
  node: GraphV2ViewportNode,
  visuals: ResolvedViewportVisuals | null,
): Record<string, unknown> {
  const isRepresentative = node.is_representative || node.member_count > 1;
  const metadata = node.metadata ?? undefined;
  const color = visuals
    ? deriveColor(metadata?.[visuals.colorField], visuals.palette)
    : isRepresentative
      ? GRAPH_VIEWER_V2_REPRESENTATIVE_COLOR
      : GRAPH_VIEWER_V2_NODE_COLOR;
  const size =
    visuals && visuals.numericStats
      ? deriveSize(metadata?.[visuals.sizeField], visuals.numericStats, visuals.scale)
      : nodeSizeForMemberCount(node.member_count);
  return {
    x: node.x,
    y: node.y,
    size,
    label: node.is_representative ? "" : node.id,
    color,
    cluster_id: node.cluster_id,
    member_count: node.member_count,
    is_cluster_proxy: isRepresentative || undefined,
    type: isRepresentative ? SIGMA_NODE_TYPE_TRIANGLE : undefined,
    layout_status: node.layout_status,
    ...(metadata ? { metadata } : {}),
    ...pieNodeAttributes(metadata, visuals),
  };
}

// Build pie-chart slice/colour attributes from node metadata when a pie mapping
// is active. Mirrors applyVisualMappings' attribute semantics; ancillary rows
// are unavailable under LoD, so categories come from the server-aggregated
// __category_count__ keys already embedded in node metadata.
function pieNodeAttributes(
  metadata: Record<string, GraphV2MetadataValue> | undefined,
  visuals: ResolvedViewportVisuals | null,
): Record<string, unknown> {
  const pie = visuals?.pie;
  if (!pie || !metadata) {
    return {};
  }

  const excludedFields = [visuals.sizeField];
  const pieAttributes = buildPieAttributes(metadata, pie, excludedFields, []);
  const pieCategoryColors = buildPieCategoryColorAttributes(
    metadata,
    pie,
    excludedFields,
    [],
  );

  return {
    ...pieAttributes,
    ...(Object.keys(pieCategoryColors).length > 0
      ? { [PIE_CATEGORY_COLORS_ATTRIBUTE]: pieCategoryColors }
      : {}),
    ...(pie.palette && pie.palette.length > 0
      ? { [PIE_PALETTE_ATTRIBUTE]: pie.palette }
      : {}),
  };
}

function graphEdgeAttributes(
  edge: GraphV2ViewportEdge,
): Record<string, unknown> {
  return {
    color: GRAPH_VIEWER_V2_EDGE_COLOR,
    size: 1,
    distance: edge.distance ?? undefined,
    label:
      typeof edge.distance === "number" && Number.isFinite(edge.distance)
        ? String(edge.distance)
        : "",
  };
}
