import type Graph from "graphology";

import type { GraphViewportEdge, GraphViewportNode, GraphViewportResponse } from "../../../../api/graphContracts";
import type { MetadataField } from "../../../../contracts/models";
import type { GraphDisplayOptions } from "../../../renderer.types";
import { hasActiveFilters, matchesFilterState } from "../../../../ancillary/filterEngine";
import type { MetadataFilterState } from "../../../../ancillary/metadataTypes";
import {
  buildValueColorMap,
  DEFAULT_COLOR_PALETTE,
  DEFAULT_PROFILE_COUNT_FIELD,
  resolveColorField,
  resolveDefaultSizeField,
  SIZE_SCALE_LINEAR,
  type VisualMappingOptions,
} from "../../../mapping/visualMapping";
import { buildGraphViewportEdgeAttributes } from "./graphViewportEdgeAttributes";
import { buildGraphViewportNodeAttributes } from "./graphViewportNodeAttributes";
import type { ResolvedViewportVisuals } from "./graphViewportAttributes.types";

export {
  GRAPH_VIEWER_BASE_EDGE_SIZE,
  GRAPH_VIEWER_EDGE_COLOR,
  buildGraphViewportEdgeAttributes,
} from "./graphViewportEdgeAttributes";
export {
  DEFAULT_GRAPH_VIEWER_NODE_SIZE,
  GRAPH_VIEWER_MAX_MEMBER_SIZE_BOOST,
  GRAPH_VIEWER_MEMBER_SIZE_FACTOR,
  GRAPH_VIEWER_NODE_COLOR,
  GRAPH_VIEWER_REPRESENTATIVE_COLOR,
  buildGraphViewportNodeAttributes,
  deriveViewportNodeColor,
  isExpandableRepresentative,
  nodeSizeForMemberCount,
} from "./graphViewportNodeAttributes";
export type { ResolvedViewportVisuals } from "./graphViewportAttributes.types";

// Metadata-driven color/size + filter settings applied while syncing a viewport.
export interface ViewportSyncSettings {
  visualMapping?: VisualMappingOptions;
  filterState?: MetadataFilterState;
  metadataSchema?: MetadataField[];
  // Presentation toggles (node labels, edge distance labels, distance-weighted
  // edge thickness). Applied per-node/edge during sync so the LoD path honors
  // the same display options as the static render path.
  displayOptions?: GraphDisplayOptions;
}

export function syncGraphologyViewport(
  graph: Graph,
  response: GraphViewportResponse,
  settings?: ViewportSyncSettings,
): void {
  const nodes = filteredViewportNodes(response, settings);
  const visuals = resolveViewportVisuals(nodes, settings);
  const displayOptions = settings?.displayOptions;
  const liveNodeIds = new Set(nodes.map((node) => node.id));
  nodes.forEach((node) => upsertGraphNode(graph, node, visuals, displayOptions));
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

function upsertGraphNode(
  graph: Graph,
  node: GraphViewportNode,
  visuals: ResolvedViewportVisuals | null,
  displayOptions?: GraphDisplayOptions,
): void {
  const attributes = buildGraphViewportNodeAttributes(node, visuals, displayOptions);
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
  const attributes = buildGraphViewportEdgeAttributes(edge, displayOptions);
  if (!graph.hasEdge(edge.id)) {
    graph.addEdgeWithKey(edge.id, edge.source, edge.target, attributes);
    return;
  }
  Object.entries(attributes).forEach(([key, value]) => {
    graph.setEdgeAttribute(edge.id, key, value);
  });
}
