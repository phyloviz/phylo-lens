import { EMPTY_ANCILLARY_FILTER_STATE } from "../../ancillary/filterEngine";
import { GRAPH_WORKBENCH_ERRORS } from "./graphWorkbench.errors";
import type { GraphWorkbenchState, GraphSession } from "./graphWorkbench.types";

export function createInitialWorkbenchState(): GraphWorkbenchState {
  return {
    preparedSession: null,
    graphSnapshot: null,
    activeFilters: EMPTY_ANCILLARY_FILTER_STATE,
    lodRefreshPaused: false,
    focusedNodeId: null,
  };
}

export function isSessionPrepared(state: GraphWorkbenchState): boolean {
  return state.preparedSession !== null;
}

export function getPreparedSession(
  state: GraphWorkbenchState,
  errorMessage = GRAPH_WORKBENCH_ERRORS.noGraphRendered,
): GraphSession {
  if (!state.preparedSession) {
    throw new Error(errorMessage);
  }

  return state.preparedSession;
}
