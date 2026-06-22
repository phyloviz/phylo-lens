import {
  type DatasetClient,
  type NormalizeRequest,
} from "../../api/datasetClient";
import {
  type CanonicalDataset,
  type SearchDatasetResponse,
  SOURCE_FORMAT_NEWICK,
} from "../../contracts/models";
import { type PositionedGraph } from "../../contracts/positioned";
import {
  ClientGraphFilterEngine,
  type GraphFilterEngine,
} from "../../ancillary/filterEngine";
import type {
  GraphRenderer,
  RenderNodeClickState,
  RenderViewportState,
} from "../../render/types";
import { buildFullPositionedGraph } from "./graphSlice";
import {
  DEFAULT_VIEWPORT,
  DEFAULT_VIEW_CHANGE_DEBOUNCE_MS,
  DEFAULT_VIEW_SLICE_MAX_NODES,
  DEFAULT_VIEW_SLICE_ZOOM,
  normalizeViewport,
  normalizeZoom,
  resolveMaxNodesForZoom,
  serializeViewKey,
} from "./graphViewport";
import { searchFullRenderedDataset } from "./search/graphSearch";
import {
  getClickedClusterId,
  isClusterProxyClick,
  toggleClusterExpansion,
} from "./lod/clusterExpansion";
import { refreshVisibleSlice } from "./lod/sliceRefresh";
import { renderMappedCurrentSlice } from "./rendering/graphRendering";
import {
  applyMetadataFilters,
  clearMetadataFilters,
  updateVisualMapping,
} from "./rendering/graphFilters";
import type {
  GraphWorkbench,
  GraphWorkbenchOptions,
  GraphWorkbenchState,
  RenderNewickOptions,
} from "./workbenchTypes";
import {
  ERR_LOD_PLAYBACK_REQUIRES_LOD,
  ERR_NO_GRAPH_RENDERED,
} from "./workbenchErrors";
import {
  clearPendingViewRefresh,
  createInitialGraphWorkbenchState,
  resetWorkbenchForNewDataset,
} from "./workbenchState";

export {
  DEFAULT_RENDER_VIEW_SUPPRESSION_MS,
  DEFAULT_VIEWPORT,
  DEFAULT_VIEW_CHANGE_DEBOUNCE_MS,
  DEFAULT_VIEW_SLICE_MAX_NODES,
  DEFAULT_VIEW_SLICE_ZOOM,
  MAX_DYNAMIC_VIEW_SLICE_NODES,
} from "./graphViewport";
export type {
  GraphNodeClickedHandler,
  GraphRenderedHandler,
  GraphWorkbench,
  GraphWorkbenchOptions,
  RenderNewickOptions,
} from "./workbenchTypes";

export const DEFAULT_DATASET_NAME = "uploaded-dataset";
export const DEFAULT_FULL_RENDER_NODE_LIMIT = 4000;
export const SEARCH_FOCUS_LOD_ZOOM = 8;
export const DEFAULT_SEARCH_RESULT_LIMIT = 50;
export { ERR_LOD_PLAYBACK_REQUIRES_LOD, ERR_NO_GRAPH_RENDERED };

export function createGraphWorkbench(
  options: GraphWorkbenchOptions,
): GraphWorkbench {
  const state = createInitialGraphWorkbenchState();
  const filterEngine = options.filterEngine ?? new ClientGraphFilterEngine();

  const renderer = options.rendererFactory.createRenderer(options.rendererKind);
  renderer.mount(options.renderContext);

  renderer.setViewChangeHandler?.((viewState) => {
    void handleViewChange({
      state,
      renderer,
      datasetClient: options.datasetClient,
      filterEngine,
      viewState,
    });
  });

  renderer.setNodeClickHandler?.((clickState) => {
    void handleNodeClick({
      state,
      renderer,
      datasetClient: options.datasetClient,
      filterEngine,
      clickState,
    });
  });

  return {
    renderNewick: (newick, datasetName, renderOptions) =>
      renderNewick({
        state,
        renderer,
        datasetClient: options.datasetClient,
        filterEngine,
        newick,
        datasetName,
        options: renderOptions,
      }),

    applyMetadataFilters: (filterState) =>
      applyMetadataFilters({
        state,
        renderer,
        filterEngine,
        filterState,
      }),

    clearMetadataFilters: () =>
      clearMetadataFilters({
        state,
        renderer,
      }),

    updateVisualMapping: (visualMapping) =>
      updateVisualMapping({
        state,
        renderer,
        filterEngine,
        visualMapping,
      }),

    updateDisplayOptions: (displayOptions) => {
      renderer.updateDisplayOptions?.(displayOptions);
      if (state.currentGraph) {
        renderer.render(state.currentGraph);
      }
    },

    setLodRefreshPaused: (paused) =>
      setLodRefreshPaused({
        state,
        renderer,
        datasetClient: options.datasetClient,
        filterEngine,
        paused,
      }),

    isLodRefreshPaused: () => state.lodRefreshPaused,

    searchNodes: (query) =>
      searchNodes({
        state,
        datasetClient: options.datasetClient,
        query,
      }),

    focusNode: (nodeId) =>
      focusNode({
        state,
        renderer,
        datasetClient: options.datasetClient,
        filterEngine,
        nodeId,
      }),

    setGraphRenderedHandler: (handler) => {
      state.graphRenderedHandler = handler;
    },

    setNodeClickedHandler: (handler) => {
      state.nodeClickedHandler = handler;
    },

    dispose: () => {
      disposeGraphWorkbench(state, renderer);
    },
  };
}

function shouldUseLodMode(
  dataset: CanonicalDataset,
  options: RenderNewickOptions,
): boolean {
  if (options.lod?.enabled !== undefined) {
    return options.lod.enabled;
  }

  const fullRenderLimit =
    options.lod?.fullRenderNodeLimit ?? DEFAULT_FULL_RENDER_NODE_LIMIT;

  return dataset.nodes.length > fullRenderLimit;
}

interface RenderFullDatasetArgs {
  state: GraphWorkbenchState;
  renderer: GraphRenderer;
  filterEngine: GraphFilterEngine;
  dataset: CanonicalDataset;
  options: RenderNewickOptions;
}

function renderFullDataset({
  state,
  renderer,
  filterEngine,
  dataset,
  options,
}: RenderFullDatasetArgs): PositionedGraph {
  const positionedGraph = buildFullPositionedGraph(dataset, options.layout);

  state.renderMode = "full";
  state.currentSliceDataset = dataset;
  state.currentPositionedSliceGraph = positionedGraph;

  return renderMappedCurrentSlice({
    state,
    renderer,
    filterEngine,
    visualMapping: options.visualMapping,
  });
}

interface RenderNewickArgs {
  state: GraphWorkbenchState;
  renderer: GraphRenderer;
  datasetClient: DatasetClient;
  filterEngine: GraphFilterEngine;
  newick: string;
  datasetName?: string;
  options?: RenderNewickOptions;
}

async function renderNewick({
  state,
  renderer,
  datasetClient,
  filterEngine,
  newick,
  datasetName = DEFAULT_DATASET_NAME,
  options = {},
}: RenderNewickArgs): Promise<PositionedGraph> {
  resetWorkbenchForNewDataset(state);
  renderer.focusNode?.(null);

  const request: NormalizeRequest = {
    format: SOURCE_FORMAT_NEWICK,
    dataset_name: datasetName,
    content: newick,
    metadata_schema: options.metadataSchema ?? [],
    metadata_by_node_id: options.metadataByNodeId ?? {},
    ancillary_data: options.ancillaryData,
  };

  const normalized = await datasetClient.normalizeDataset(request);
  const metadataSchema = normalized.dataset.metadata_schema;
  const metadataByNodeId = normalized.dataset.metadata_by_node_id;
  const ancillaryRowsByNodeId =
    normalized.dataset.ancillary_rows_by_node_id ?? {};

  if (!shouldUseLodMode(normalized.dataset, options)) {
    return renderFullDataset({
      state,
      renderer,
      filterEngine,
      dataset: normalized.dataset,
      options,
    });
  }

  const preparedDataset = await datasetClient.prepareDataset(request);

  state.renderMode = "lod";
  state.preparedSession = {
    datasetId: preparedDataset.dataset_id,
    metadataSchema,
    metadataByNodeId,
    ancillaryRowsByNodeId,
    visualMapping: options.visualMapping,
    layout: options.layout,
    lod: {
      maxNodes: options.lod?.maxNodes ?? DEFAULT_VIEW_SLICE_MAX_NODES,
      lodHint: options.lod?.lodHint,
      viewport: options.lod?.viewport ?? DEFAULT_VIEWPORT,
    },
  };

  return refreshVisibleSlice({
    state,
    renderer,
    datasetClient,
    filterEngine,
    viewState: {
      viewport: state.preparedSession.lod.viewport,
      zoom: options.lod?.zoom ?? DEFAULT_VIEW_SLICE_ZOOM,
    },
  });
}

interface SetLodRefreshPausedArgs {
  state: GraphWorkbenchState;
  renderer: GraphRenderer;
  datasetClient: DatasetClient;
  filterEngine: GraphFilterEngine;
  paused: boolean;
}

async function setLodRefreshPaused({
  state,
  renderer,
  datasetClient,
  filterEngine,
  paused,
}: SetLodRefreshPausedArgs): Promise<PositionedGraph | null> {
  if (!state.preparedSession || state.renderMode !== "lod") {
    throw new Error(ERR_LOD_PLAYBACK_REQUIRES_LOD);
  }

  if (paused) {
    state.lodRefreshPaused = true;
    clearPendingViewRefresh(state);
    return state.currentGraph;
  }

  state.lodRefreshPaused = false;
  clearPendingViewRefresh(state);

  const nextViewState = state.deferredViewState ??
    state.currentViewState ?? {
      viewport: state.preparedSession.lod.viewport,
      zoom: DEFAULT_VIEW_SLICE_ZOOM,
    };
  state.deferredViewState = null;

  return refreshVisibleSlice({
    state,
    renderer,
    datasetClient,
    filterEngine,
    viewState: nextViewState,
  });
}

interface HandleViewChangeArgs {
  state: GraphWorkbenchState;
  renderer: GraphRenderer;
  datasetClient: DatasetClient;
  filterEngine: GraphFilterEngine;
  viewState: RenderViewportState;
}

async function handleViewChange({
  state,
  renderer,
  datasetClient,
  filterEngine,
  viewState,
}: HandleViewChangeArgs): Promise<void> {
  const session = state.preparedSession;

  if (!session || state.renderMode !== "lod") {
    return;
  }

  const effectiveViewport = normalizeViewport(viewState.viewport);
  const effectiveZoom = normalizeZoom(viewState.zoom);

  if (state.lodRefreshPaused) {
    state.deferredViewState = {
      viewport: effectiveViewport,
      zoom: effectiveZoom,
    };
    clearPendingViewRefresh(state);
    return;
  }

  const effectiveMaxNodes = resolveMaxNodesForZoom(
    session.lod.maxNodes,
    effectiveZoom,
  );

  const nextViewKey = serializeViewKey(
    effectiveViewport,
    effectiveZoom,
    effectiveMaxNodes,
    session.lod.lodHint,
    undefined,
    undefined,
    [...state.expandedClusterIds],
    [...state.collapsedClusterIds],
  );

  if (nextViewKey === state.lastRequestedViewKey) {
    return;
  }

  clearPendingViewRefresh(state);

  const suppressionDelay = Math.max(
    0,
    state.suppressViewChangesUntil - Date.now(),
  );
  state.pendingViewRefreshId = window.setTimeout(() => {
    state.pendingViewRefreshId = null;

    void refreshVisibleSlice({
      state,
      renderer,
      datasetClient,
      filterEngine,
      viewState: {
        viewport: effectiveViewport,
        zoom: effectiveZoom,
      },
    });
  }, suppressionDelay + DEFAULT_VIEW_CHANGE_DEBOUNCE_MS);
}

interface HandleNodeClickArgs {
  state: GraphWorkbenchState;
  renderer: GraphRenderer;
  datasetClient: DatasetClient;
  filterEngine: GraphFilterEngine;
  clickState: RenderNodeClickState;
}

async function handleNodeClick({
  state,
  renderer,
  datasetClient,
  filterEngine,
  clickState,
}: HandleNodeClickArgs): Promise<void> {
  state.nodeClickedHandler?.(clickState);

  const session = state.preparedSession;

  if (!session || state.renderMode !== "lod") {
    return;
  }

  const clickedNode = state.currentGraph?.nodes.find(
    (node) => node.id === clickState.nodeId,
  );

  const clickedClusterId = getClickedClusterId(clickState, clickedNode);

  if (!clickedClusterId || !isClusterProxyClick(clickState, clickedNode)) {
    return;
  }

  toggleClusterExpansion(state, clickedClusterId);

  const currentViewState = state.currentViewState ?? {
    viewport: session.lod.viewport,
    zoom: DEFAULT_VIEW_SLICE_ZOOM,
  };

  await refreshVisibleSlice({
    state,
    renderer,
    datasetClient,
    filterEngine,
    viewState: {
      viewport: currentViewState.viewport,
      zoom: currentViewState.zoom,
    },
    options: {
      focusNodeIdOverride: clickState.nodeId,
      focusClusterIdOverride: clickedClusterId,
    },
  });
}

interface SearchNodesArgs {
  state: GraphWorkbenchState;
  datasetClient: DatasetClient;
  query: {
    query: string;
    limit?: number;
    includeMetadataKeys?: string[];
  };
}

async function searchNodes({
  state,
  datasetClient,
  query,
}: SearchNodesArgs): Promise<SearchDatasetResponse> {
  const session = state.preparedSession;

  if (state.renderMode === "full") {
    if (!state.currentSliceDataset) {
      throw new Error(ERR_NO_GRAPH_RENDERED);
    }

    return searchFullRenderedDataset({
      dataset: state.currentSliceDataset,
      query: query.query,
      limit: query.limit ?? DEFAULT_SEARCH_RESULT_LIMIT,
      includeMetadataKeys: query.includeMetadataKeys,
    });
  }

  if (!session || state.renderMode !== "lod") {
    throw new Error(ERR_NO_GRAPH_RENDERED);
  }

  return datasetClient.searchDataset({
    dataset_id: session.datasetId,
    query: query.query,
    limit: query.limit,
    include_metadata_keys:
      query.includeMetadataKeys ??
      session.metadataSchema.map((field) => field.key),
  });
}

interface FocusNodeArgs {
  state: GraphWorkbenchState;
  renderer: GraphRenderer;
  datasetClient: DatasetClient;
  filterEngine: GraphFilterEngine;
  nodeId: string;
}

async function focusNode({
  state,
  renderer,
  datasetClient,
  filterEngine,
  nodeId,
}: FocusNodeArgs): Promise<PositionedGraph> {
  const session = state.preparedSession;

  if (state.renderMode === "full") {
    const graph = state.currentGraph ?? state.currentSliceGraph;
    if (!graph) {
      throw new Error(ERR_NO_GRAPH_RENDERED);
    }

    if (graph.nodes.some((node) => node.id === nodeId)) {
      renderer.focusNode?.(nodeId);
      renderer.centerOnNode?.(nodeId);
    }

    return graph;
  }

  if (!session || state.renderMode !== "lod") {
    throw new Error(ERR_NO_GRAPH_RENDERED);
  }

  const currentViewState = state.currentViewState ?? {
    viewport: session.lod.viewport,
    zoom: DEFAULT_VIEW_SLICE_ZOOM,
  };
  const focusZoom = Math.max(currentViewState.zoom, SEARCH_FOCUS_LOD_ZOOM);

  return refreshVisibleSlice({
    state,
    renderer,
    datasetClient,
    filterEngine,
    viewState: {
      viewport: currentViewState.viewport,
      zoom: focusZoom,
    },
    options: {
      focusNodeIdOverride: nodeId,
      centerOnNodeId: nodeId,
      focusRenderedNodeId: nodeId,
    },
  });
}

function disposeGraphWorkbench(
  state: GraphWorkbenchState,
  renderer: GraphRenderer,
): void {
  clearPendingViewRefresh(state);
  renderer.setViewChangeHandler?.(null);
  renderer.setNodeClickHandler?.(null);
  renderer.unmount();
}
