import { type PositionedGraph } from "../../contracts/positioned";
import graphFilters from "./graphFilters";
import { loadGraph } from "./loadGraph";
import { createInitialWorkbenchState, isSessionPrepared, getPreparedSession } from "./graphWorkbench.state";
import type {
  GraphNodeClickedHandler,
  GraphRenderedHandler,
  GraphWorkbench,
  GraphWorkbenchOptions,
  GraphWorkbenchState,
} from "./graphWorkbench.types";
import {
  ERR_GRAPH_VIEWPORT_SYNC_REQUIRED,
  ERR_LOD_PLAYBACK_REQUIRES_LOD,
  ERR_NO_GRAPH_RENDERED,
} from "./graphWorkbench.errors";
import graphNavigation from "./graphNavigation";
import { GraphViewportCoordinator } from "./viewport/viewportCoordinator";
import type { SnapshotAppliedObserver } from "./internalSnapshotObserver";
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

  let viewportCoordinator: GraphViewportCoordinator | null = null;
  let graphRenderedHandler: GraphRenderedHandler | null = null;
  let nodeClickedHandler: GraphNodeClickedHandler | null = null;

  let loadGeneration = 0;
  let snapshotSequence = 0;
  let disposed = false;

  const replaceViewportCoordinator = (controller: GraphViewportCoordinator | null) => {
    viewportCoordinator?.unmount();
    viewportCoordinator = controller;
  };

  const renderer = options.rendererFactory.createRenderer(options.rendererKind);
  renderer.mount(options.renderContext);

  const filters = graphFilters({
    getState,
    dispatch,
    renderer,
    getViewportCoordinator: () => viewportCoordinator,
  });

  const navigation = graphNavigation({
    getState,
    dispatch,
    renderer,
    graphClient: options.graphClient,
    getViewportCoordinator: () => viewportCoordinator,
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
      viewportCoordinator?.refreshNow();
    }

    return getState().graphSnapshot;
  }

  const requireViewportCoordinator = (): GraphViewportCoordinator => {
    if (disposed || !viewportCoordinator || !isSessionPrepared(getState())) {
      throw new Error(ERR_NO_GRAPH_RENDERED);
    }

    return viewportCoordinator;
  };

  return {
    setMotionEnabled: (enabled) => renderer.setMotionEnabled?.(enabled),
    isMotionEnabled: () => renderer.isMotionEnabled?.() ?? false,
    setInteractionFeedbackHandler: (handler) => renderer.setInteractionFeedbackHandler?.(handler),
    setDragSelection: (selection) => renderer.setDragSelection?.(selection),
    resetLayoutEdits: () => renderer.resetLayoutEdits?.(),
    expandCluster: (id) => requireViewportCoordinator().expandCluster(id),
    collapseCluster: (id) => requireViewportCoordinator().collapseCluster(id),
    expandAll: () => requireViewportCoordinator().expandAll(),
    collapseAll: () => requireViewportCoordinator().collapseAll(),
    setKeepExpanded: (keep) => requireViewportCoordinator().setKeepExpanded(keep),
    getExpansionState: () => requireViewportCoordinator().getExpansionState(),
    loadGraph: (input, loadOptions) => {
      const generation = ++loadGeneration;

      return loadGraph(
        {
          getState,
          dispatch,
          renderer,
          graphClient: options.graphClient,

          replaceViewportCoordinator,

          isCurrentLoad: () => !disposed && generation === loadGeneration,

          snapshotObserver,
          nextSnapshotSequence: () => ++snapshotSequence,

          onGraphRendered: (graph) => graphRenderedHandler?.(graph),
        },
        input,
        loadOptions,
      );
    },

    applyAncillaryData: async (data) => {
      const controller = requireViewportCoordinator();
      const session = getPreparedSession(getState());
      const generation = loadGeneration;

      const result = await options.graphClient.applyAncillaryData({
        dataset_id: session.datasetId,
        layout_version: session.layoutVersion,
        ancillary_data: data,
      });

      if (disposed || generation !== loadGeneration || viewportCoordinator !== controller) {
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
      replaceViewportCoordinator(null);
      renderer.unmount();
    },
  };
}
