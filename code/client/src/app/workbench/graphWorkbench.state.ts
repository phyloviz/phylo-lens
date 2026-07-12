import { EMPTY_METADATA_FILTER_STATE } from "../../ancillary/filterEngine";
import { ERR_NO_GRAPH_RENDERED } from "./graphWorkbench.errors";
import type { GraphWorkbenchState, PreparedDatasetSession } from "./graphWorkbench.types";

export function createInitialWorkbenchState(): GraphWorkbenchState {
  return {
    currentSliceDataset: null,
    currentGraph: null,
    metadataIndex: null,
    metadataIndexSignature: null,
    activeFilters: EMPTY_METADATA_FILTER_STATE,
    preparedSession: null,
    pendingViewRefreshId: null,
    lodRefreshPaused: false,
    graphRenderedHandler: null,
    nodeClickedHandler: null,
    focusedNodeId: null,
  };
}

export function resetWorkbenchState(state: GraphWorkbenchState): void {
  state.currentSliceDataset = null;
  state.currentGraph = null;
  state.metadataIndex = null;
  state.metadataIndexSignature = null;
  state.activeFilters = EMPTY_METADATA_FILTER_STATE;
  state.preparedSession = null;
  state.pendingViewRefreshId = null;
  state.lodRefreshPaused = false;
  state.focusedNodeId = null;
}

export function clearPendingViewRefresh(state: GraphWorkbenchState): void {
  if (state.pendingViewRefreshId === null) {
    return;
  }

  window.clearTimeout(state.pendingViewRefreshId);
  state.pendingViewRefreshId = null;
}

export function requirePreparedSession(
  state: GraphWorkbenchState,
  errorMessage = ERR_NO_GRAPH_RENDERED,
): PreparedDatasetSession {
  if (!state.preparedSession) {
    throw new Error(errorMessage);
  }

  return state.preparedSession;
}
