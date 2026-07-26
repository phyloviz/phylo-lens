import type { GraphClient } from "../../api/graphClient";
import type { NormalizeRequest } from "../../api/graphContracts";
import { SOURCE_FORMAT_NEWICK } from "../../contracts/models";
import { type PositionedGraph } from "../../contracts/positioned";
import type { GraphRenderer } from "../../render/renderer.types";
import { DEFAULT_VIEWPORT, DEFAULT_VIEW_SLICE_MAX_NODES, createEmptyGraph } from "./viewportGraph";
import graphFilters from "./graphFilters";
import {
  clearPendingViewRefresh,
  createInitialWorkbenchState,
  requirePreparedSession,
  resetWorkbenchState,
} from "./graphWorkbench.state";
import type {
  GraphWorkbench,
  GraphWorkbenchOptions,
  GraphWorkbenchState,
  RenderNewickOptions,
} from "./graphWorkbench.types";
import {
  ERR_GRAPH_VIEWPORT_SYNC_REQUIRED,
  ERR_LOD_PLAYBACK_REQUIRES_LOD,
  ERR_NO_GRAPH_RENDERED,
} from "./graphWorkbench.errors";
import graphNavigation from "./graphNavigation";
import { ViewportSyncController } from "./viewport/viewportSyncController";

export { DEFAULT_VIEWPORT, DEFAULT_VIEW_SLICE_MAX_NODES } from "./viewportGraph";
export type {
  GraphNodeClickedHandler,
  GraphRenderedHandler,
  GraphWorkbench,
  GraphWorkbenchOptions,
  RenderNewickOptions,
} from "./graphWorkbench.types";

export const DEFAULT_DATASET_NAME = "uploaded-dataset";
export const DEFAULT_SEARCH_RESULT_LIMIT = 50;
export const ERR_GRAPH_LOAD_SUPERSEDED = "Graph load was superseded by a newer load.";
export { ERR_GRAPH_VIEWPORT_SYNC_REQUIRED, ERR_LOD_PLAYBACK_REQUIRES_LOD, ERR_NO_GRAPH_RENDERED };

export function createGraphWorkbench(options: GraphWorkbenchOptions): GraphWorkbench {
  const state = createInitialWorkbenchState();
  let viewportSync: ViewportSyncController | null = null;
  let loadGeneration = 0;
  let disposed = false;
  const replaceViewportSync = (controller: ViewportSyncController | null) => {
    viewportSync?.unmount();
    viewportSync = controller;
  };

  const renderer = options.rendererFactory.createRenderer(options.rendererKind);
  renderer.mount(options.renderContext);
  const filters = graphFilters({ state, renderer, getViewportSync: () => viewportSync });
  const navigation = graphNavigation({
    state,
    renderer,
    graphClient: options.graphClient,
    getViewportSync: () => viewportSync,
  });

  renderer.setNodeClickHandler?.((clickState) => {
    state.focusedNodeId = clickState.nodeId;
    viewportSync?.handleNodeClick(clickState);
    state.nodeClickedHandler?.(clickState);
  });
  renderer.setNodeDoubleClickHandler?.((clickState) => {
    viewportSync?.handleNodeDoubleClick(clickState);
  });

  async function setLodRefreshPaused(paused: boolean): Promise<PositionedGraph | null> {
    requirePreparedSession(state, ERR_LOD_PLAYBACK_REQUIRES_LOD);

    state.lodRefreshPaused = paused;
    clearPendingViewRefresh(state);
    // On resume, reconcile the frozen view to wherever the camera drifted while
    // paused. refreshNow() bypasses the pause guard in ViewportSyncController.
    if (!paused) {
      viewportSync?.refreshNow();
    }
    return state.currentGraph;
  }

  return {
    renderNewick: (newick, datasetName, renderOptions) => {
      const generation = ++loadGeneration;
      return renderNewick({
        isCurrentLoad: () => !disposed && generation === loadGeneration,
        state,
        renderer,
        graphClient: options.graphClient,
        setViewportSync: replaceViewportSync,
        newick,
        datasetName,
        options: renderOptions,
      });
    },

    applyMetadataFilters: filters.applyMetadataFilters,

    clearMetadataFilters: filters.clearMetadataFilters,

    updateVisualMapping: filters.updateVisualMapping,

    updateDisplayOptions: filters.updateDisplayOptions,

    setLodRefreshPaused,

    isLodRefreshPaused: () => state.lodRefreshPaused,

    searchNodes: navigation.searchNodes,

    focusNode: navigation.focusNode,

    setGraphRenderedHandler: (handler) => {
      state.graphRenderedHandler = handler;
    },

    setNodeClickedHandler: (handler) => {
      state.nodeClickedHandler = handler;
    },

    setRegionSelectModeEnabled: (enabled) => {
      renderer.setRegionSelectModeEnabled?.(enabled);
    },

    selectRegion: navigation.selectRegion,

    setRegionSelectedHandler: (handler) => {
      renderer.setRegionSelectedHandler?.(handler);
    },

    clearRegionSelection: () => {
      renderer.setHighlightedNodes?.(null);
    },

    dispose: () => {
      disposed = true;
      loadGeneration += 1;
      clearPendingViewRefresh(state);
      renderer.setViewChangeHandler?.(null);
      renderer.setNodeClickHandler?.(null);
      renderer.setNodeDoubleClickHandler?.(null);
      renderer.setRegionSelectedHandler?.(null);
      renderer.setHighlightedNodes?.(null);
      replaceViewportSync(null);
      renderer.unmount();
    },
  };
}

interface RenderNewickArgs {
  state: GraphWorkbenchState;
  renderer: GraphRenderer;
  graphClient: GraphClient;
  setViewportSync: (controller: ViewportSyncController | null) => void;
  isCurrentLoad: () => boolean;
  newick: string;
  datasetName?: string;
  options?: RenderNewickOptions;
}

async function renderNewick({
  state,
  renderer,
  graphClient,
  setViewportSync,
  isCurrentLoad,
  newick,
  datasetName = DEFAULT_DATASET_NAME,
  options = {},
}: RenderNewickArgs): Promise<PositionedGraph> {
  setViewportSync(null);
  resetWorkbenchState(state);
  renderer.focusNode?.(null);

  const request: NormalizeRequest = {
    format: options.sourceFormat ?? SOURCE_FORMAT_NEWICK,
    dataset_name: datasetName,
    content: newick,
    metadata_schema: options.metadataSchema ?? [],
    metadata_by_node_id: options.metadataByNodeId ?? {},
    ancillary_data: options.ancillaryData,
  };

  if (!renderer.getViewportSyncState || !renderer.applyGraphSnapshot) {
    throw new Error(ERR_GRAPH_VIEWPORT_SYNC_REQUIRED);
  }

  const preparedGraph = await graphClient.prepareGraph(request);
  if (!isCurrentLoad()) {
    throw new Error(ERR_GRAPH_LOAD_SUPERSEDED);
  }

  state.preparedSession = {
    datasetId: preparedGraph.dataset_id,
    layoutVersion: preparedGraph.layout_version,
    metadataSchema: options.metadataSchema ?? [],
    metadataByNodeId: options.metadataByNodeId ?? {},
    ancillaryRowsByNodeId: {},
    visualMapping: options.visualMapping,
    displayOptions: options.displayOptions,
    layoutWarnings: preparedGraph.warnings,
    layout: options.layout,
    lodTierCount: preparedGraph.lod_tier_count,
    lod: {
      maxNodes: options.lod?.maxNodes ?? DEFAULT_VIEW_SLICE_MAX_NODES,
      lodHint: options.lod?.lodHint,
      viewport: options.lod?.viewport ?? DEFAULT_VIEWPORT,
    },
  };
  state.currentSliceDataset = null;

  const viewportSync = new ViewportSyncController({
    client: graphClient,
    datasetId: preparedGraph.dataset_id,
    layoutVersion: preparedGraph.layout_version,
    renderer,
    maxNodes: state.preparedSession.lod.maxNodes,
    lodTierCount: preparedGraph.lod_tier_count,
    nodeCount: preparedGraph.node_count,
    getPaused: () => state.lodRefreshPaused,
    onGraphSynced: (graph, response) => {
      if (response && state.preparedSession) {
        state.preparedSession.metadataSchema = response.metadata_schema ?? [];
      }
      graph.viewMeta.lodTierCount = state.preparedSession?.lodTierCount;
      graph.viewMeta.layoutWarnings = state.preparedSession?.layoutWarnings;
      state.currentGraph = graph;
      state.graphRenderedHandler?.(graph);
    },
    getRenderSettings: () => ({
      visualMapping: state.preparedSession?.visualMapping,
      filterState: state.activeFilters,
      metadataSchema: state.preparedSession?.metadataSchema,
      displayOptions: state.preparedSession?.displayOptions,
    }),
  });
  setViewportSync(viewportSync);
  viewportSync.mount();

  try {
    const graph = await viewportSync.waitForInitialViewport();
    if (!isCurrentLoad()) {
      throw new Error(ERR_GRAPH_LOAD_SUPERSEDED);
    }
    return graph;
  } catch (error) {
    if (!isCurrentLoad()) {
      throw new Error(ERR_GRAPH_LOAD_SUPERSEDED);
    }
    setViewportSync(null);
    state.currentGraph = createEmptyGraph();
    throw error;
  }
}
