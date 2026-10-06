import { type PositionedGraph } from '../../contracts/positioned';
import { createGraphAncillaryUpdater } from './updateGraphAncillaryData';
import graphFilters from './graphFilters';
import { loadGraph } from './loadGraph';
import { createInitialWorkbenchState, hasGraphSession, getGraphSnapshot } from './graphWorkbench.state';
import type {
  GraphNodeClickedHandler,
  GraphRenderedHandler,
  GraphWorkbench,
  GraphWorkbenchOptions,
} from './graphWorkbench.types';
import type { GraphWorkbenchState } from './graphWorkbench.state';
import { GRAPH_WORKBENCH_ERRORS } from './graphWorkbench.errors';
import graphNavigation from './graphNavigation';
import { GraphViewportCoordinator } from './viewport/viewportCoordinator';
import type { SnapshotAppliedObserver } from './internalSnapshotObserver';
import type { GraphWorkbenchAction } from './graphWorkbench.actions';
import { reduceGraphWorkbenchState } from './graphWorkbench.reducer';

export type {
  GraphInput,
  LoadGraphOptions,
  GraphNodeClickedHandler,
  GraphRenderedHandler,
  GraphWorkbench,
  GraphWorkbenchOptions,
} from './graphWorkbench.types';

export function createGraphWorkbench(
  options: GraphWorkbenchOptions,
  snapshotObserver?: SnapshotAppliedObserver
): GraphWorkbench {
  const { graphClient, rendererFactory, rendererType, renderContext } = options;
  // Single mutable binding for application state.
  // Other mutable variables below are locally owned lifecycle resources.
  let state = createInitialWorkbenchState();

  const getState = (): GraphWorkbenchState => state;

  const dispatch = (action: GraphWorkbenchAction): void => {
    state = reduceGraphWorkbenchState(state, action);
  };

  let viewportCoordinator: GraphViewportCoordinator | null = null;
  let errorHandler: ((error: Error) => void) | null = null;
  let graphRenderedHandler: GraphRenderedHandler | null = null;
  let nodeClickedHandler: GraphNodeClickedHandler | null = null;

  let loadGeneration = 0;
  let snapshotSequence = 0;
  let disposed = false;

  const replaceViewportCoordinator = (coordinator: GraphViewportCoordinator | null) => {
    viewportCoordinator?.unmount();
    viewportCoordinator = coordinator;
  };

  const renderer = rendererFactory.createRenderer(rendererType);
  renderer.mount(renderContext);

  const filters = graphFilters({
    getState,
    dispatch,
    renderer,
    getViewportCoordinator: () => viewportCoordinator,
  });

  const navigation = graphNavigation({
    getState,
    renderer,
    graphClient,
    getViewportCoordinator: () => viewportCoordinator,
    getLoadGeneration: () => loadGeneration,
  });

  renderer.setNodeClickHandler?.(clickState => {
    navigation.cancelPendingFocus();

    nodeClickedHandler?.(clickState);
  });

  function setLodRefreshPaused(paused: boolean): PositionedGraph | null {
    if (!hasGraphSession(getState())) {
      return null;
    }

    dispatch({
      kind: 'lodRefreshPaused',
      paused,
    });

    if (!paused) {
      viewportCoordinator?.refreshNow();
    }

    return getGraphSnapshot(getState());
  }

  const requireViewportCoordinator = (): GraphViewportCoordinator => {
    if (disposed || !viewportCoordinator || !hasGraphSession(getState())) {
      throw new Error(GRAPH_WORKBENCH_ERRORS.noGraphRendered);
    }

    return viewportCoordinator;
  };

  const updateAncillaryData = createGraphAncillaryUpdater({
    getState,
    graphClient,
    requireViewportCoordinator,
    getLoadGeneration: () => loadGeneration,
    getViewportCoordinator: () => viewportCoordinator,
  });

  return {
    setMotionEnabled: enabled => renderer.setMotionEnabled?.(enabled),
    isMotionEnabled: () => renderer.isMotionEnabled?.() ?? false,
    setInteractionFeedbackHandler: handler => renderer.setInteractionFeedbackHandler?.(handler),
    setDragSelection: selection => renderer.setDragSelection?.(selection),
    resetLayoutEdits: () => renderer.resetLayoutEdits?.(),
    expandCluster: id => requireViewportCoordinator().expandCluster(id),
    collapseCluster: id => requireViewportCoordinator().collapseCluster(id),
    expandAll: () => requireViewportCoordinator().expandAll(),
    collapseAll: () => requireViewportCoordinator().collapseAll(),
    setKeepExpanded: keep => requireViewportCoordinator().setKeepExpanded(keep),
    getExpansionState: () => requireViewportCoordinator().getExpansionState(),
    loadGraph: (input, loadOptions) => {
      const generation = ++loadGeneration;
      navigation.cancelPendingRegionSelection();

      return loadGraph(
        {
          getState,
          dispatch,
          renderer,
          graphClient,

          replaceViewportCoordinator,

          isCurrentLoad: () => !disposed && generation === loadGeneration,

          snapshotObserver,
          nextSnapshotSequence: () => ++snapshotSequence,

          onGraphRendered: graph => graphRenderedHandler?.(graph),
          onError: error => errorHandler?.(error),
        },
        input,
        loadOptions
      );
    },

    applyAncillaryData: updateAncillaryData,

    exportPng: exportOptions => {
      if (!renderer.exportPng) {
        throw new Error(GRAPH_WORKBENCH_ERRORS.pngExportUnavailable);
      }
      return renderer.exportPng(exportOptions);
    },

    applyAncillaryFilters: filters.applyAncillaryFilters,

    clearAncillaryFilters: filters.clearAncillaryFilters,

    updateVisualMapping: filters.updateVisualMapping,

    updateDisplayOptions: filters.updateDisplayOptions,

    setLodRefreshPaused,

    isLodRefreshPaused: () => getState().lodRefreshPaused,

    searchNodes: navigation.searchNodes,

    focusNode: navigation.focusNode,
    cancelPendingFocus: navigation.cancelPendingFocus,

    setErrorHandler: handler => {
      errorHandler = handler;
    },

    setGraphRenderedHandler: handler => {
      graphRenderedHandler = handler;
    },

    setNodeClickedHandler: handler => {
      nodeClickedHandler = handler;
    },

    setRegionSelectModeEnabled: enabled => {
      renderer.setRegionSelectModeEnabled?.(enabled);
    },

    selectRegion: navigation.selectRegion,

    setRegionSelectedHandler: handler => {
      renderer.setRegionSelectedHandler?.(handler);
    },

    clearRegionSelection: () => {
      navigation.cancelPendingRegionSelection();
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
