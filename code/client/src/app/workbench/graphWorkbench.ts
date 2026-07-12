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
export { ERR_GRAPH_VIEWPORT_SYNC_REQUIRED, ERR_LOD_PLAYBACK_REQUIRES_LOD, ERR_NO_GRAPH_RENDERED };

export function createGraphWorkbench(options: GraphWorkbenchOptions): GraphWorkbench {
  const state = createInitialWorkbenchState();

  const renderer = options.rendererFactory.createRenderer(options.rendererKind);
  renderer.mount(options.renderContext);
  const filters = graphFilters({ state, renderer });
  const navigation = graphNavigation({
    state,
    renderer,
    graphClient: options.graphClient,
  });

  renderer.setViewChangeHandler?.(() => {
    if (!state.preparedSession) {
      return;
    }

    clearPendingViewRefresh(state);
  });

  renderer.setNodeClickHandler?.((clickState) => {
    state.focusedNodeId = clickState.nodeId;
    state.nodeClickedHandler?.(clickState);
  });

  async function setLodRefreshPaused(paused: boolean): Promise<PositionedGraph | null> {
    requirePreparedSession(state, ERR_LOD_PLAYBACK_REQUIRES_LOD);

    state.lodRefreshPaused = paused;
    clearPendingViewRefresh(state);
    // On resume, reconcile the frozen view to wherever the camera drifted while
    // paused. refreshNow() bypasses the pause guard in GraphViewportController.
    if (!paused) {
      renderer.refreshGraphViewportSync?.();
    }
    return state.currentGraph;
  }

  return {
    renderNewick: (newick, datasetName, renderOptions) =>
      renderNewick({
        state,
        renderer,
        graphClient: options.graphClient,
        newick,
        datasetName,
        options: renderOptions,
      }),

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
      clearPendingViewRefresh(state);
      renderer.setViewChangeHandler?.(null);
      renderer.setNodeClickHandler?.(null);
      renderer.setRegionSelectedHandler?.(null);
      renderer.setHighlightedNodes?.(null);
      renderer.stopGraphViewportSync?.();
      renderer.unmount();
    },
  };
}

interface RenderNewickArgs {
  state: GraphWorkbenchState;
  renderer: GraphRenderer;
  graphClient: GraphClient;
  newick: string;
  datasetName?: string;
  options?: RenderNewickOptions;
}

async function renderNewick({
  state,
  renderer,
  graphClient,
  newick,
  datasetName = DEFAULT_DATASET_NAME,
  options = {},
}: RenderNewickArgs): Promise<PositionedGraph> {
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

  if (!renderer.startGraphViewportSync) {
    throw new Error(ERR_GRAPH_VIEWPORT_SYNC_REQUIRED);
  }

  const preparedGraph = await graphClient.prepareGraph(request);

  state.preparedSession = {
    datasetId: preparedGraph.dataset_id,
    layoutVersion: preparedGraph.layout_version,
    metadataSchema: options.metadataSchema ?? [],
    metadataByNodeId: options.metadataByNodeId ?? {},
    ancillaryRowsByNodeId: {},
    visualMapping: options.visualMapping,
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

  renderer.startGraphViewportSync({
    client: graphClient,
    datasetId: preparedGraph.dataset_id,
    layoutVersion: preparedGraph.layout_version,
    maxNodes: state.preparedSession.lod.maxNodes,
    lodTierCount: preparedGraph.lod_tier_count,
    nodeCount: preparedGraph.node_count,
    getPaused: () => state.lodRefreshPaused,
    onGraphSynced: (graph) => {
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

  const placeholderGraph = createEmptyGraph();
  state.currentGraph = placeholderGraph;
  state.graphRenderedHandler?.(placeholderGraph);
  return placeholderGraph;
}
