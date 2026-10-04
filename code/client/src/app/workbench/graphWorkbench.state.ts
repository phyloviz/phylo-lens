import { EMPTY_ANCILLARY_FILTER_STATE } from "../../ancillary/filterEngine";
import { GRAPH_WORKBENCH_ERRORS } from "./graphWorkbench.errors";
import type { GraphWorkbenchState, GraphSession } from "./graphWorkbench.types";

export function createInitialWorkbenchState(): GraphWorkbenchState {
  return {
    graphSession: null,
    graphSnapshot: null,
    activeFilters: EMPTY_ANCILLARY_FILTER_STATE,
    lodRefreshPaused: false,
    focusedNodeId: null,
  };
}

export function hasGraphSession(state: GraphWorkbenchState): boolean {
  return state.graphSession !== null;
}

export function getGraphSession(
  state: GraphWorkbenchState,
  errorMessage = GRAPH_WORKBENCH_ERRORS.noGraphRendered,
): GraphSession {
  if (!state.graphSession) {
    throw new Error(errorMessage);
  }

  return state.graphSession;
}
