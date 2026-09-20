import { resolveAncillaryInput } from "../../ancillary/ancillaryInput";
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
import type { SnapshotAppliedObserver } from "./internalSnapshotObserver";
import { GRAPH_VIEWER_SMALL_TREE_NODE_THRESHOLD } from "./viewport/viewportQuery";

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
export const ERR_GRAPH_PNG_EXPORT_UNAVAILABLE = "PNG export is unavailable for this renderer.";
export { ERR_GRAPH_VIEWPORT_SYNC_REQUIRED, ERR_LOD_PLAYBACK_REQUIRES_LOD, ERR_NO_GRAPH_RENDERED };

export function createGraphWorkbench(
  options: GraphWorkbenchOptions,
  snapshotObserver?: SnapshotAppliedObserver,
): GraphWorkbench {
  const state = createInitialWorkbenchState();
  let viewportSync: ViewportSyncController | null = null;
  let loadGeneration = 0;
  let snapshotSequence = 0;
  let disposed = false;
  let applyingAncillary = false;
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
    navigation.cancelPendingFocus();
    state.focusedNodeId = clickState.nodeId;
    state.nodeClickedHandler?.(clickState);
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

  const requireViewportSync = () => {
    requirePreparedSession(state);
    if (disposed || !viewportSync) throw new Error(ERR_NO_GRAPH_RENDERED);
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
        isCurrentLoad: () => !disposed && generation === loadGeneration,
        state,
        renderer,
        graphClient: options.graphClient,
        setViewportSync: replaceViewportSync,
        newick,
        datasetName,
        options: renderOptions,
        snapshotObserver,
        nextSnapshotSequence: () => ++snapshotSequence,
      });
    },

    applyAncillaryData: async (data) => {
      const session = requirePreparedSession(state);
      const controller = viewportSync;
      if (disposed || !controller || !session.layoutVersion || !state.currentGraph || applyingAncillary) {
        throw new Error("Cannot apply ancillary data to this view while another update is pending or after disposal.");
      }
      applyingAncillary = true;
      try {
        const result = await options.graphClient.applyAncillaryData({
          dataset_id: session.datasetId,
          layout_version: session.layoutVersion,
          ancillary_data: data,
        });
        if (disposed || state.preparedSession !== session || viewportSync !== controller) {
          throw new Error(ERR_GRAPH_LOAD_SUPERSEDED);
        }
        await controller.replaceLayoutVersion(result.layout_version);
        return result;
      } finally {
        applyingAncillary = false;
      }
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

    isLodRefreshPaused: () => state.lodRefreshPaused,

    searchNodes: navigation.searchNodes,

    focusNode: navigation.focusNode,
    cancelPendingFocus: navigation.cancelPendingFocus,

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
  snapshotObserver?: SnapshotAppliedObserver;
  nextSnapshotSequence: () => number;
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
  snapshotObserver,
  nextSnapshotSequence,
}: RenderNewickArgs): Promise<PositionedGraph> {
  setViewportSync(null);
  resetWorkbenchState(state);
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

  const maxNodes = options.lod?.maxNodes ?? DEFAULT_VIEW_SLICE_MAX_NODES;

  const smallTreeThreshold = options.lod?.smallTreeThreshold ?? GRAPH_VIEWER_SMALL_TREE_NODE_THRESHOLD;

  state.preparedSession = {
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
      maxNodes: maxNodes,
      smallTreeThreshold: smallTreeThreshold,
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
    smallTreeThreshold: state.preparedSession.lod.smallTreeThreshold,
    lodTierCount: preparedGraph.lod_tier_count,
    nodeCount: preparedGraph.node_count,
    getPaused: () => state.lodRefreshPaused,
    onGraphSynced: (graph, response) => {
      if (response && state.preparedSession) {
        state.preparedSession.ancillarySchema = response.metadata_schema ?? [];
        state.preparedSession.layoutVersion = response.layout_version;
      }
      graph.viewMeta.lodTierCount = state.preparedSession?.lodTierCount;
      graph.viewMeta.layoutWarnings = state.preparedSession?.layoutWarnings;
      state.currentGraph = graph;
      state.graphRenderedHandler?.(graph);
    },
    snapshotObserver,
    nextSnapshotSequence,
    getRenderSettings: () => ({
      visualMapping: state.preparedSession?.visualMapping,
      filterState: state.activeFilters,
      ancillarySchema: state.preparedSession?.ancillarySchema,
      ancillaryByNodeId: state.preparedSession?.ancillaryByNodeId,
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
