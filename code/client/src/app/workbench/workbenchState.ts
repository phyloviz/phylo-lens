import {
  EMPTY_METADATA_FILTER_STATE,
} from "../../ancillary/filterEngine";
import type { GraphWorkbenchState } from "./workbenchTypes";

export function createInitialGraphWorkbenchState(): GraphWorkbenchState {
  return {
    currentSliceDataset: null,
    currentPositionedSliceGraph: null,
    currentSliceGraph: null,
    currentGraph: null,
    metadataIndex: null,
    metadataIndexSignature: null,
    activeFilters: EMPTY_METADATA_FILTER_STATE,
    preparedSession: null,
    pendingViewRefreshId: null,
    lastRequestedViewKey: null,
    sliceRequestSequence: 0,
    currentViewState: null,
    deferredViewState: null,
    lodRefreshPaused: false,
    graphRenderedHandler: null,
    nodeClickedHandler: null,
    suppressViewChangesUntil: 0,
    renderMode: null,
    focusedNodeId: null,
  };
}

export function resetWorkbenchForNewDataset(
  state: GraphWorkbenchState,
): void {
  state.currentSliceDataset = null;
  state.currentPositionedSliceGraph = null;
  state.currentSliceGraph = null;
  state.currentGraph = null;
  state.metadataIndex = null;
  state.metadataIndexSignature = null;
  state.activeFilters = EMPTY_METADATA_FILTER_STATE;
  state.preparedSession = null;
  state.pendingViewRefreshId = null;
  state.lastRequestedViewKey = null;
  state.currentViewState = null;
  state.deferredViewState = null;
  state.lodRefreshPaused = false;
  state.renderMode = null;
  state.focusedNodeId = null;
}

export function clearPendingViewRefresh(state: GraphWorkbenchState): void {
  if (state.pendingViewRefreshId === null) {
    return;
  }

  window.clearTimeout(state.pendingViewRefreshId);
  state.pendingViewRefreshId = null;
}
