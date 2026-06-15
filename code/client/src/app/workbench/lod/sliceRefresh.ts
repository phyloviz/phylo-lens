import type { DatasetClient } from "../../../api/datasetClient";
import type { GraphFilterEngine } from "../../../ancillary/filterEngine";
import type { PositionedGraph } from "../../../contracts/positioned";
import type { GraphRenderer, RenderViewportState } from "../../../render/types";
import {
  buildPositionedSliceGraph,
  buildSliceDataset,
  emptyGraph,
  serverSpatialBoundsToGraphBounds,
} from "../graphSlice";
import {
  DEFAULT_RENDER_VIEW_SUPPRESSION_MS,
  normalizeViewport,
  normalizeZoom,
  resolveMaxNodesForZoom,
  serializeViewKey,
} from "../graphViewport";
import { renderMappedCurrentSlice } from "../rendering/graphRendering";
import { ERR_NO_GRAPH_RENDERED } from "../workbenchErrors";
import type { GraphWorkbenchState } from "../workbenchTypes";

export interface RefreshVisibleSliceArgs {
  state: GraphWorkbenchState;
  renderer: GraphRenderer;
  datasetClient: DatasetClient;
  filterEngine: GraphFilterEngine;
  viewState: RenderViewportState;
  options?: {
    focusNodeIdOverride?: string;
    focusClusterIdOverride?: string;
    centerOnNodeId?: string;
    focusRenderedNodeId?: string;
  };
}

export async function refreshVisibleSlice({
  state,
  renderer,
  datasetClient,
  filterEngine,
  viewState,
  options = {},
}: RefreshVisibleSliceArgs): Promise<PositionedGraph> {
  const session = state.preparedSession;

  if (!session) {
    throw new Error(ERR_NO_GRAPH_RENDERED);
  }

  const requestSequence = ++state.sliceRequestSequence;
  const effectiveViewport = normalizeViewport(viewState.viewport);
  const effectiveZoom = normalizeZoom(viewState.zoom);
  const focusNodeId = options.focusNodeIdOverride;
  const focusClusterId = options.focusClusterIdOverride;

  state.currentViewState = {
    viewport: effectiveViewport,
    zoom: effectiveZoom,
  };

  const effectiveMaxNodes = resolveMaxNodesForZoom(
    session.lod.maxNodes,
    effectiveZoom,
  );

  state.lastRequestedViewKey = serializeViewKey(
    effectiveViewport,
    effectiveZoom,
    effectiveMaxNodes,
    session.lod.lodHint,
    focusNodeId,
    focusClusterId,
    [...state.expandedClusterIds],
    [...state.collapsedClusterIds],
  );

  const visibleSlice = await datasetClient.viewSlice({
    dataset_id: session.datasetId,
    viewport: effectiveViewport,
    zoom: effectiveZoom,
    lod_hint: session.lod.lodHint,
    max_nodes: effectiveMaxNodes,
    focus_node_id: focusNodeId,
    focus_cluster_id: focusClusterId,
    expanded_cluster_ids: [...state.expandedClusterIds],
    collapsed_cluster_ids: [...state.collapsedClusterIds],
    include_metadata_keys: session.metadataSchema.map((field) => field.key),
  });

  if (requestSequence !== state.sliceRequestSequence) {
    return state.currentGraph ?? state.currentSliceGraph ?? emptyGraph();
  }

  const sliceDataset = buildSliceDataset(
    session.datasetId,
    visibleSlice.nodes,
    visibleSlice.edges,
    session.metadataSchema,
    session.metadataByNodeId,
    session.ancillaryRowsByNodeId,
  );

  const previousSliceGraph =
    state.currentPositionedSliceGraph ?? state.currentSliceGraph;

  const positionedGraph = buildPositionedSliceGraph(
    sliceDataset,
    {
      forceIterations: session.layout?.forceIterations,
    },
    previousSliceGraph,
  );

  state.currentSliceDataset = sliceDataset;
  state.currentPositionedSliceGraph = applySliceViewMeta(
    positionedGraph,
    visibleSlice,
  );

  const renderedGraph = renderMappedCurrentSlice({
    state,
    renderer,
    filterEngine,
    visualMapping: session.visualMapping,
  });

  state.suppressViewChangesUntil =
    Date.now() + DEFAULT_RENDER_VIEW_SUPPRESSION_MS;

  if (
    options.centerOnNodeId &&
    renderedGraph.nodes.some((node) => node.id === options.centerOnNodeId)
  ) {
    renderer.centerOnNode?.(options.centerOnNodeId);
  }

  if (
    options.focusRenderedNodeId &&
    renderedGraph.nodes.some((node) => node.id === options.focusRenderedNodeId)
  ) {
    renderer.focusNode?.(options.focusRenderedNodeId);
  }

  return renderedGraph;
}

function applySliceViewMeta(
  graph: PositionedGraph,
  visibleSlice: Awaited<ReturnType<DatasetClient["viewSlice"]>>,
): PositionedGraph {
  return {
    ...graph,
    viewMeta: {
      ...graph.viewMeta,
      lodLevel: visibleSlice.lod_level,
      sliceNodeCount: visibleSlice.view_meta.returned_node_count,
      sliceEdgeCount: visibleSlice.view_meta.returned_edge_count,
      collapsedClusterCount: visibleSlice.collapsed_clusters.length,
      zoom: visibleSlice.view_meta.zoom,
      globalBounds:
        serverSpatialBoundsToGraphBounds(
          visibleSlice.view_meta.global_bounds,
        ) ?? graph.viewMeta.globalBounds,
    },
  };
}
