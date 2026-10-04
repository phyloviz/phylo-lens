import { resolveAncillaryInput } from "../../ancillary/ancillaryInput";
import type { NormalizeRequest, GraphClient } from "../../api/graphContracts";
import { SOURCE_FORMAT_NEWICK } from "../../contracts/models";
import { type PositionedGraph } from "../../contracts/positioned";
import type { GraphRenderer } from "../../render/renderer.types";
import { DEFAULT_VIEWPORT } from "./viewportGraph";
import graphFilters from "./graphFilters";
import { createInitialWorkbenchState, isSessionPrepared, getPreparedSession } from "./graphWorkbench.state";
import type {
  GraphNodeClickedHandler,
  GraphRenderedHandler,
  GraphWorkbench,
  GraphWorkbenchOptions,
  GraphWorkbenchState,
  GraphSession,
  RenderNewickOptions,
} from "./graphWorkbench.types";
import {
  ERR_GRAPH_VIEWPORT_SYNC_REQUIRED,
  ERR_LOD_PLAYBACK_REQUIRES_LOD,
  ERR_NO_GRAPH_RENDERED,
} from "./graphWorkbench.errors";
import graphNavigation from "./graphNavigation";
import { GraphViewportCoordinator } from "./viewport/viewportCoordinator";
import type { SnapshotAppliedObserver } from "./internalSnapshotObserver";
import { GRAPH_VIEWER_SMALL_TREE_NODE_THRESHOLD } from "./viewport/viewportQuery";
import { ACTIONS, type GraphWorkbenchAction } from "./graphWorkbench.actions";
import { reduceGraphWorkbenchState } from "./graphWorkbench.reducer";

export { DEFAULT_VIEWPORT } from "./viewportGraph";
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
export const ERR_GRAPH_PNG_EXPORT_UNAVAILABLE = "PNG export is unavailable for this renderer.";
export { ERR_GRAPH_VIEWPORT_SYNC_REQUIRED, ERR_LOD_PLAYBACK_REQUIRES_LOD, ERR_NO_GRAPH_RENDERED };

export function createGraphWorkbench(
  options: GraphWorkbenchOptions,
  snapshotObserver?: SnapshotAppliedObserver,
): GraphWorkbench {
  // Single mutable binding for application state.
  // Other mutable variables below are locally owned lifecycle resources.
  let state = createInitialWorkbenchState();

  const getState = (): GraphWorkbenchState => state;

  const dispatch = (action: GraphWorkbenchAction): void => {
    state = reduceGraphWorkbenchState(state, action);
  };

  let viewportSync: GraphViewportCoordinator | null = null;
  let graphRenderedHandler: GraphRenderedHandler | null = null;
  let nodeClickedHandler: GraphNodeClickedHandler | null = null;

  let loadGeneration = 0;
  let snapshotSequence = 0;
  let disposed = false;

  const replaceViewportSync = (controller: GraphViewportCoordinator | null) => {
    viewportSync?.unmount();
    viewportSync = controller;
  };

  const renderer = options.rendererFactory.createRenderer(options.rendererKind);
  renderer.mount(options.renderContext);

  const filters = graphFilters({
    getState,
    dispatch,
    renderer,
    getViewportSync: () => viewportSync,
  });

  const navigation = graphNavigation({
    getState,
    dispatch,
    renderer,
    graphClient: options.graphClient,
    getViewportSync: () => viewportSync,
  });

  renderer.setNodeClickHandler?.((clickState) => {
    navigation.cancelPendingFocus();

    dispatch({
      type: ACTIONS.nodeFocused,
      nodeId: clickState.nodeId,
    });

    nodeClickedHandler?.(clickState);
  });

  async function setLodRefreshPaused(paused: boolean): Promise<PositionedGraph | null> {
    if (!isSessionPrepared(getState())) {
      return null;
    }

    dispatch({
      type: ACTIONS.lodRefreshPaused,
      paused,
    });

    // keep whatever pending-refresh cleanup you currently need

    if (!paused) {
      viewportSync?.refreshNow();
    }

    return getState().graphSnapshot;
  }

  const requireViewportSync = (): GraphViewportCoordinator => {
    if (disposed || !viewportSync || !isSessionPrepared(getState())) {
      throw new Error(ERR_NO_GRAPH_RENDERED);
    }

    return viewportSync;
  };

  return {
    setMotionEnabled: (enabled) => renderer.setMotionEnabled?.(enabled),
    isMotionEnabled: () => renderer.isMotionEnabled?.() ?? false,
    setInteractionFeedbackHandler: (handler) => renderer.setInteractionFeedbackHandler?.(handler),
    setDragSelection: (selection) => renderer.setDragSelection?.(selection),
    resetLayoutEdits: () => renderer.resetLayoutEdits?.(),
    expandCluster: (id) => requireViewportSync().expandCluster(id),
    collapseCluster: (id) => requireViewportSync().collapseCluster(id),
    expandAll: () => requireViewportSync().expandAll(),
    collapseAll: () => requireViewportSync().collapseAll(),
    setKeepExpanded: (keep) => requireViewportSync().setKeepExpanded(keep),
    getExpansionState: () => requireViewportSync().getExpansionState(),
    renderNewick: (newick, datasetName, renderOptions) => {
      const generation = ++loadGeneration;
      return renderNewick({
        getState,
        dispatch,
        isCurrentLoad: () => !disposed && generation === loadGeneration,
        renderer,
        graphClient: options.graphClient,
        setViewportSync: replaceViewportSync,
        newick,
        datasetName,
        options: renderOptions,
        snapshotObserver,
        nextSnapshotSequence: () => ++snapshotSequence,
        onGraphRendered: (graph) => graphRenderedHandler?.(graph),
      });
    },

    applyAncillaryData: async (data) => {
      const controller = requireViewportSync();
      const session = getPreparedSession(getState());
      const generation = loadGeneration;

      const result = await options.graphClient.applyAncillaryData({
        dataset_id: session.datasetId,
        layout_version: session.layoutVersion,
        ancillary_data: data,
      });

      if (disposed || generation !== loadGeneration || viewportSync !== controller) {
        throw new Error(ERR_GRAPH_LOAD_SUPERSEDED);
      }

      await controller.replaceLayoutVersion(result.layout_version);

      return result;
    },

    exportPng: (exportOptions) => {
      if (!renderer.exportPng) {
        throw new Error(ERR_GRAPH_PNG_EXPORT_UNAVAILABLE);
      }
      return renderer.exportPng(exportOptions);
    },

    applyMetadataFilters: filters.applyMetadataFilters,

    clearMetadataFilters: filters.clearMetadataFilters,

    updateVisualMapping: filters.updateVisualMapping,

    updateDisplayOptions: filters.updateDisplayOptions,

    setLodRefreshPaused,

    isLodRefreshPaused: () => getState().lodRefreshPaused,

    searchNodes: navigation.searchNodes,

    focusNode: navigation.focusNode,
    cancelPendingFocus: navigation.cancelPendingFocus,

    setGraphRenderedHandler: (handler) => {
      graphRenderedHandler = handler;
    },

    setNodeClickedHandler: (handler) => {
      nodeClickedHandler = handler;
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
  getState: () => GraphWorkbenchState;
  dispatch: (action: GraphWorkbenchAction) => void;

  renderer: GraphRenderer;
  graphClient: GraphClient;
  setViewportSync: (controller: GraphViewportCoordinator | null) => void;
  isCurrentLoad: () => boolean;

  newick: string;
  datasetName?: string;
  options?: RenderNewickOptions;

  snapshotObserver?: SnapshotAppliedObserver;
  nextSnapshotSequence: () => number;

  onGraphRendered?: (graph: PositionedGraph) => void;
}

async function renderNewick({
  getState,
  dispatch,
  renderer,
  graphClient,
  setViewportSync,
  isCurrentLoad,
  newick,
  datasetName = DEFAULT_DATASET_NAME,
  options = {},
  snapshotObserver,
  nextSnapshotSequence,
  onGraphRendered,
}: RenderNewickArgs): Promise<PositionedGraph> {
  setViewportSync(null);
  dispatch({
    type: ACTIONS.reset,
  });
  const motionEnabled = renderer.isMotionEnabled?.() ?? true;
  renderer.resetLayoutEdits?.();
  renderer.setMotionEnabled?.(motionEnabled);
  renderer.focusNode?.(null);

  const ancillary = resolveAncillaryInput(options);
  const request: NormalizeRequest = {
    format: options.sourceFormat ?? SOURCE_FORMAT_NEWICK,
    dataset_name: datasetName,
    content: newick,
    metadata_schema: ancillary.ancillarySchema,
    metadata_by_node_id: ancillary.ancillaryByNodeId,
    ancillary_data: options.ancillaryData,
    sfdp_options: options.sfdpOptions,
  };

  if (!renderer.getViewportSyncState || !renderer.applyGraphSnapshot) {
    throw new Error(ERR_GRAPH_VIEWPORT_SYNC_REQUIRED);
  }

  const preparedGraph = await graphClient.prepareGraph(request);
  if (!isCurrentLoad()) {
    throw new Error(ERR_GRAPH_LOAD_SUPERSEDED);
  }

  const maxNodes = options.lod?.maxNodes;

  const smallTreeThreshold = options.lod?.smallTreeThreshold ?? GRAPH_VIEWER_SMALL_TREE_NODE_THRESHOLD;

  const session: GraphSession = {
    datasetId: preparedGraph.dataset_id,
    layoutVersion: preparedGraph.layout_version,

    ancillarySchema: ancillary.ancillarySchema,
    ancillaryByNodeId: ancillary.ancillaryByNodeId,
    ancillaryRowsByNodeId: {},

    visualMapping: options.visualMapping,
    displayOptions: options.displayOptions,

    layoutWarnings: preparedGraph.warnings,
    lodTierCount: preparedGraph.lod_tier_count,

    lod: {
      maxNodes,
      representationSpacingPx: options.lod?.representationSpacingPx,
      smallTreeThreshold,
      lodHint: options.lod?.lodHint,
      viewport: options.lod?.viewport ?? DEFAULT_VIEWPORT,
    },
  };

  dispatch({
    type: ACTIONS.graphPrepared,
    session,
  });

  const viewportSync = new GraphViewportCoordinator({
    client: graphClient,
    datasetId: session.datasetId,
    layoutVersion: session.layoutVersion!,
    renderer,

    maxNodes: session.lod.maxNodes,
    representationSpacingPx: session.lod.representationSpacingPx,
    smallTreeThreshold: session.lod.smallTreeThreshold,
    lodTierCount: preparedGraph.lod_tier_count,
    nodeCount: preparedGraph.node_count,
    getPaused: () => getState().lodRefreshPaused,
    onGraphSynced: (graph, response) => {
      dispatch({
        type: ACTIONS.viewportSynced,
        graph,
        response,
      });

      const currentGraph = getState().graphSnapshot;

      if (currentGraph) {
        onGraphRendered?.(currentGraph);
      }
    },
    snapshotObserver,
    nextSnapshotSequence,
    getRenderSettings: () => {
      const state = getState();

      return {
        visualMapping: state.preparedSession?.visualMapping,
        filterState: state.activeFilters,
        ancillarySchema: state.preparedSession?.ancillarySchema,
        ancillaryByNodeId: state.preparedSession?.ancillaryByNodeId,
        displayOptions: state.preparedSession?.displayOptions,
      };
    },
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

    dispatch({
      type: ACTIONS.graphCleared,
    });

    throw error;
  }
}
