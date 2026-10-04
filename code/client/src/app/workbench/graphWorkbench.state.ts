import { EMPTY_ANCILLARY_FILTER_STATE } from "../../ancillary/filterEngine";
import { ERR_NO_GRAPH_RENDERED } from "./graphWorkbench.errors";
import type { GraphWorkbenchState, GraphSession } from "./graphWorkbench.types";

export function createInitialWorkbenchState(): GraphWorkbenchState {
  return {
    preparedSession: null,
    graphSnapshot: null,
    activeFilters: EMPTY_ANCILLARY_FILTER_STATE,
    lodRefreshPaused: false,
    focusedNodeId: null,
    currentSliceDataset: null,
  };
}

export function isSessionPrepared(state: GraphWorkbenchState): boolean {
  return state.preparedSession !== null;
}

export function getPreparedSession(state: GraphWorkbenchState, errorMessage = ERR_NO_GRAPH_RENDERED): GraphSession {
  if (!state.preparedSession) {
    throw new Error(errorMessage);
  }

  return state.preparedSession;
}
