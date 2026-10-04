import { type PositionedGraph } from "../../contracts/positioned";
import { updateGraphAncillaryData } from "./updateGraphAncillaryData";
import graphFilters from "./graphFilters";
import { loadGraph } from "./loadGraph";
import { createInitialWorkbenchState, hasGraphSession } from "./graphWorkbench.state";
import type {
  GraphNodeClickedHandler,
  GraphRenderedHandler,
  GraphWorkbench,
  GraphWorkbenchOptions,
  GraphWorkbenchState,
} from "./graphWorkbench.types";
import { GRAPH_WORKBENCH_ERRORS } from "./graphWorkbench.errors";
import graphNavigation from "./graphNavigation";
import { GraphViewportCoordinator } from "./viewport/viewportCoordinator";
import type { SnapshotAppliedObserver } from "./internalSnapshotObserver";
import { ACTIONS, type GraphWorkbenchAction } from "./graphWorkbench.actions";
import { reduceGraphWorkbenchState } from "./graphWorkbench.reducer";

export { DEFAULT_VIEWPORT } from "./viewportGraph";
export type {
  GraphInput,
  LoadGraphOptions,
  GraphNodeClickedHandler,
  GraphRenderedHandler,
  GraphWorkbench,
  GraphWorkbenchOptions,
} from "./graphWorkbench.types";

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
    getLoadGeneration: () => loadGeneration,
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
    if (!hasGraphSession(getState())) {
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
    if (disposed || !viewportCoordinator || !hasGraphSession(getState())) {
      throw new Error(GRAPH_WORKBENCH_ERRORS.noGraphRendered);
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

    applyAncillaryData: (data) =>
      updateGraphAncillaryData(
        {
          getState,
          graphClient: options.graphClient,
          requireViewportCoordinator,
          getLoadGeneration: () => loadGeneration,
          getViewportCoordinator: () => viewportCoordinator,
        },
        data,
      ),

    exportPng: (exportOptions) => {
      if (!renderer.exportPng) {
        throw new Error(GRAPH_WORKBENCH_ERRORS.pngExportUnavailable);
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
