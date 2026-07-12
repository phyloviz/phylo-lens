import type Graph from "graphology";

import type {
  GraphMetadataValue,
  GraphViewportEdge,
  GraphViewportNode,
  GraphViewportResponse,
} from "../../../api/graphContracts";
import type { MetadataField } from "../../../contracts/models";
import type { GraphDisplayOptions } from "../../types";
import { hasActiveFilters, matchesFilterState } from "../../../ancillary/filterEngine";
import type { MetadataFilterState } from "../../../ancillary/metadataTypes";
import {
  buildValueColorMap,
  DEFAULT_COLOR_PALETTE,
  DEFAULT_PROFILE_COUNT_FIELD,
  deriveSize,
  resolveColorField,
  resolveDefaultSizeField,
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
  PHYLOVIZ_NODE_SELECTED_BORDER_COLOR,
  PHYLOVIZ_NODE_SELECTED_COLOR,
  SIGMA_NODE_TYPE_BORDER,
  SIGMA_NODE_TYPE_TRIANGLE,
} from "./sigmaRenderingConstants";
import { derivePhylovizNodeColor, edgeSizeForDistance } from "./sigmaStyle";

export const DEFAULT_GRAPH_VIEWER_NODE_SIZE = 5;
export const GRAPH_VIEWER_MEMBER_SIZE_FACTOR = 1.25;
export const GRAPH_VIEWER_MAX_MEMBER_SIZE_BOOST = 6;
export const GRAPH_VIEWER_REPRESENTATIVE_COLOR = "#b45309";
export const GRAPH_VIEWER_NODE_COLOR = PHYLOVIZ_NODE_COMMON_COLOR;
export const GRAPH_VIEWER_EDGE_COLOR = "#94a3b8";
// Base thickness for a viewport edge before any distance weighting is applied.
export const GRAPH_VIEWER_BASE_EDGE_SIZE = 1;

// Metadata-driven color/size + filter settings applied while syncing a viewport.
export interface ViewportSyncSettings {
  visualMapping?: VisualMappingOptions;
  filterState?: MetadataFilterState;
  metadataSchema?: MetadataField[];
  // Presentation toggles (node labels, edge distance labels, distance-weighted
  // edge thickness). Applied per-node/edge during sync so the LoD path honors
  // the same display options as the static render path.
  displayOptions?: GraphDisplayOptions;
  // Node currently focused via search. Colored/enlarged red on every sync so the
  // highlight is durable across re-fetches and appears as soon as the node's
  // slice loads (the static render path highlights via selectedNodeId; this is
  // the LoD equivalent).
  selectedNodeId?: string | null;
}

// Resolved per-viewport color/size parameters when a visual mapping is active.
interface ResolvedViewportVisuals {
  colorField: string;
  sizeField: string;
  scale: SizeScale;
  palette: string[];
  // Frequency-ranked value -> colour resolver for colorField, built once over
  // all viewport nodes so every node fill (and the pies/wheels that mirror it)
  // share the same assignment. The most common value takes palette[0].
  colorForValue: (value: string | number | boolean | null | undefined) => string;
  numericStats?: { min: number; max: number };
  // Present only when an explicit pie mapping is active for this viewport.
  pie?: PieMappingOptions;
}

export function syncGraphologyViewport(
  graph: Graph,
  response: GraphViewportResponse,
  settings?: ViewportSyncSettings,
): void {
  const nodes = filteredViewportNodes(response, settings);
  const visuals = resolveViewportVisuals(nodes, settings);
  const displayOptions = settings?.displayOptions;
  const selectedNodeId = settings?.selectedNodeId ?? null;
  const liveNodeIds = new Set(nodes.map((node) => node.id));
  nodes.forEach((node) => upsertGraphNode(graph, node, visuals, displayOptions, selectedNodeId));
  response.edges.forEach((edge) => {
    if (!liveNodeIds.has(edge.source) || !liveNodeIds.has(edge.target)) {
      return;
    }
    upsertGraphEdge(graph, edge, displayOptions);
  });
}

// Graph mutation events that Sigma subscribes to with a *full* re-index per
// event (its dropNode/dropEdge handlers call refresh() without a partialGraph,
// forcing an O(N+E) reindex every time). Removing stale nodes one-by-one while
// those handlers are attached is therefore O(n²) and can stall for seconds on a
// large LoD transition. We suspend just these two events for the duration of
// the batch; the single sigma.refresh() the caller runs afterward performs one
// correct re-index for the final graph state.
const SIGMA_DROP_EVENTS = ["nodeDropped", "edgeDropped"] as const;

export function reconcileGraphologyViewport(
  graph: Graph,
  response: GraphViewportResponse,
  settings?: ViewportSyncSettings,
): void {
  const nodes = filteredViewportNodes(response, settings);
  const liveNodeIds = new Set(nodes.map((node) => node.id));
  const liveEdgeIds = new Set(response.edges.map((edge) => edge.id));

  // Snapshot and detach the per-drop listeners so the batch does not trigger a
  // full Sigma re-index for every removed node/edge.
  const suspendedListeners = SIGMA_DROP_EVENTS.map(
    (event) => [event, graph.rawListeners(event) as ((...args: unknown[]) => void)[]] as const,
  );
  suspendedListeners.forEach(([event]) => graph.removeAllListeners(event));

  try {
    // Drop stale edges first so subsequent dropNode calls have no incident
    // edges left to cascade through.
    graph.edges().forEach((edgeId) => {
      if (!liveEdgeIds.has(edgeId)) {
        graph.dropEdge(edgeId);
      }
    });
    graph.nodes().forEach((nodeId) => {
      if (!liveNodeIds.has(nodeId)) {
        graph.dropNode(nodeId);
      }
    });
  } finally {
    // Restore the listeners even if a drop threw, so Sigma keeps tracking
    // future mutations.
    suspendedListeners.forEach(([event, listeners]) => {
      listeners.forEach((listener) => graph.on(event, listener));
    });
  }
}

// Restrict a viewport response to nodes passing the active metadata filters.
function filteredViewportNodes(response: GraphViewportResponse, settings?: ViewportSyncSettings): GraphViewportNode[] {
  const filterState = settings?.filterState;
  if (!filterState || !hasActiveFilters(filterState)) {
    return response.nodes;
  }
  return response.nodes.filter((node) => matchesFilterState(node.metadata, filterState));
}

// Resolve color/size parameters once per viewport when a mapping is active.
function resolveViewportVisuals(
  nodes: GraphViewportNode[],
  settings?: ViewportSyncSettings,
): ResolvedViewportVisuals | null {
  const mapping = settings?.visualMapping;
  if (!mapping) {
    return null;
  }

  const colorField = resolveColorField(settings?.metadataSchema ?? [], mapping.colorField);
  const sizeField = mapping.size?.field ?? mapping.sizeField ?? resolveDefaultSizeField(viewportHasProfileCount(nodes));
  const scale = mapping.size?.scale ?? SIZE_SCALE_LINEAR;
  const palette = mapping.palette ?? DEFAULT_COLOR_PALETTE;
  const numericStats = computeSizeFieldStats(nodes, sizeField);
  // Rank the colour field's values across the whole viewport once so node fills
  // are distinct and stable, and pies/wheels can mirror the exact same mapping.
  const colorForValue = buildValueColorMap(
    nodes.map((node) => node.metadata?.[colorField]),
    palette,
  );
  // Pie is opt-in under LoD: only when an explicit, enabled pie mapping is set.
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

// True when any viewport node carries a numeric profile_count, so the default
// size mapping can size nodes by isolate count rather than branch distance.
function viewportHasProfileCount(nodes: GraphViewportNode[]): boolean {
  return nodes.some((node) => typeof node.metadata?.[DEFAULT_PROFILE_COUNT_FIELD] === "number");
}

// Compute min/max for the active size field across the current viewport nodes.
function computeSizeFieldStats(
  nodes: GraphViewportNode[],
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
    GRAPH_VIEWER_MAX_MEMBER_SIZE_BOOST,
    (Math.sqrt(safeMemberCount) - 1) * GRAPH_VIEWER_MEMBER_SIZE_FACTOR,
  );
  return DEFAULT_GRAPH_VIEWER_NODE_SIZE + boost;
}

export function isExpandableRepresentative(attributes: Record<string, unknown>): boolean {
  return (
    attributes.type === SIGMA_NODE_TYPE_TRIANGLE ||
    attributes.is_cluster_proxy === true ||
    (typeof attributes.member_count === "number" && attributes.member_count > 1)
  );
}

function upsertGraphNode(
  graph: Graph,
  node: GraphViewportNode,
  visuals: ResolvedViewportVisuals | null,
  displayOptions?: GraphDisplayOptions,
  selectedNodeId?: string | null,
): void {
  const attributes = graphNodeAttributes(node, visuals, displayOptions, selectedNodeId);
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

function upsertGraphEdge(graph: Graph, edge: GraphViewportEdge, displayOptions?: GraphDisplayOptions): void {
  if (!graph.hasNode(edge.source) || !graph.hasNode(edge.target)) {
    return;
  }
  const attributes = graphEdgeAttributes(edge, displayOptions);
  if (!graph.hasEdge(edge.id)) {
    graph.addEdgeWithKey(edge.id, edge.source, edge.target, attributes);
    return;
  }
  Object.entries(attributes).forEach(([key, value]) => {
    graph.setEdgeAttribute(edge.id, key, value);
  });
}

// Resolve a leaf/member node's default color from its PHYLOViZ role, mirroring
// the role logic in sigmaNodeAttributes.deriveNodeColor: selected wins, then
// group founder (light green), then sub-group founder (dark green), otherwise
// the common node blue. Roles are read from node metadata under any of the
// accepted key aliases. Representatives (triangles) are colored separately and
// never routed through here.
export function deriveViewportNodeColor(node: GraphViewportNode): string {
  const metadata = node.metadata ?? undefined;
  const attributes = metadata ? { metadata } : undefined;
  return derivePhylovizNodeColor(attributes);
}

function graphNodeAttributes(
  node: GraphViewportNode,
  visuals: ResolvedViewportVisuals | null,
  displayOptions?: GraphDisplayOptions,
  selectedNodeId?: string | null,
): Record<string, unknown> {
  // A proxy only renders as an (expandable) triangle when it actually stands in
  // for more than one node. The server materializes a single-member cluster per
  // node at each tier (so every node has a representative for meta-edge
  // rerouting), and those arrive with is_representative === true; drawing them
  // as triangles produced the "cluster with just one node under it" artifact on
  // larger trees. Gating on member_count > 1 renders them as plain leaves.
  const isRepresentative = node.member_count > 1;
  // A focused (searched) leaf wins over every other role/mapping color: it is
  // painted red, enlarged, and given a border so it stands out once its slice
  // loads. Representatives keep their triangle treatment even when focused.
  const isSelected = !isRepresentative && node.id === (selectedNodeId ?? null);
  const metadata = node.metadata ?? undefined;
  // Color precedence: an active metadata visual mapping is an explicit user
  // choice and wins WHEN the node actually has a value for the colour field;
  // otherwise (no mapping, or the node has no value for the mapped field)
  // representatives keep their distinct triangle tone and leaf/member nodes
  // fall back to their PHYLOViZ role color. This keeps "no data" nodes on their
  // role colour instead of a palette slot they don't belong to.
  const mappedValue = visuals ? metadata?.[visuals.colorField] : undefined;
  const hasMappedValue = mappedValue !== undefined && mappedValue !== null && mappedValue !== "";
  const roleColor = isRepresentative ? GRAPH_VIEWER_REPRESENTATIVE_COLOR : deriveViewportNodeColor(node);
  const color = isSelected
    ? PHYLOVIZ_NODE_SELECTED_COLOR
    : visuals && hasMappedValue
      ? visuals.colorForValue(mappedValue)
      : roleColor;
  const baseSize =
    visuals && visuals.numericStats
      ? deriveSize(metadata?.[visuals.sizeField], visuals.numericStats, visuals.scale)
      : nodeSizeForMemberCount(node.member_count);
  const size = isSelected ? Math.max(baseSize * 1.55, baseSize + 6) : baseSize;
  // Node labels are on by default; a representative (triangle) never carries a
  // label, and toggling the node-labels display option off blanks leaf labels.
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
    type: isSelected ? SIGMA_NODE_TYPE_BORDER : isRepresentative ? SIGMA_NODE_TYPE_TRIANGLE : undefined,
    borderColor: isSelected ? PHYLOVIZ_NODE_SELECTED_BORDER_COLOR : undefined,
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

function graphEdgeAttributes(edge: GraphViewportEdge, displayOptions?: GraphDisplayOptions): Record<string, unknown> {
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
    // Carry meta-edge provenance so downstream styling can distinguish
    // rerouted boundary edges. Phase 1 only surfaces the attributes.
    isMeta,
    bundledEdgeCount: isMeta ? (edge.bundled_edge_count ?? 1) : undefined,
  };
}
