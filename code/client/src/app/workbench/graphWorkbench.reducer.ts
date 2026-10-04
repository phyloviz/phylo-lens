import { EMPTY_ANCILLARY_FILTER_STATE } from "../../ancillary/filterEngine";
import { ACTIONS, type GraphWorkbenchAction } from "./graphWorkbench.actions";
import type { GraphWorkbenchState } from "./graphWorkbench.types";
import { createEmptyGraph } from "./viewportGraph";

export function reduceGraphWorkbenchState(
  state: GraphWorkbenchState,
  action: GraphWorkbenchAction,
): GraphWorkbenchState {
  switch (action.type) {
    case ACTIONS.reset:
      return {
        ...state,
        preparedSession: null,
        graphSnapshot: null,
        focusedNodeId: null,
        activeFilters: EMPTY_ANCILLARY_FILTER_STATE,
        lodRefreshPaused: false,
      };

    case ACTIONS.nodeFocused:
      return {
        ...state,
        focusedNodeId: action.nodeId,
      };

    case ACTIONS.lodRefreshPaused:
      return {
        ...state,
        lodRefreshPaused: action.paused,
      };

    case ACTIONS.filtersUpdated:
      return {
        ...state,
        activeFilters: action.filters,
      };

    case ACTIONS.visualMappingUpdated:
      if (!state.preparedSession) {
        return state;
      }

      return {
        ...state,
        preparedSession: {
          ...state.preparedSession,
          visualMapping: action.visualMapping,
        },
      };

    case ACTIONS.displayOptionsUpdated:
      if (!state.preparedSession) {
        return state;
      }

      return {
        ...state,
        preparedSession: {
          ...state.preparedSession,
          displayOptions: {
            ...state.preparedSession.displayOptions,
            ...action.displayOptions,
          },
        },
      };

    case ACTIONS.graphPrepared:
      return {
        ...state,
        preparedSession: action.session,
        currentSliceDataset: null,
      };

    case ACTIONS.viewportSynced: {
      const preparedSession =
        action.response && state.preparedSession
          ? {
              ...state.preparedSession,
              ancillarySchema: action.response.metadata_schema ?? [],
              layoutVersion: action.response.layout_version,
            }
          : state.preparedSession;

      return {
        ...state,
        preparedSession,
        graphSnapshot: {
          ...action.graph,
          viewMeta: {
            ...action.graph.viewMeta,
            lodTierCount: preparedSession?.lodTierCount,
            layoutWarnings: preparedSession?.layoutWarnings,
          },
        },
      };
    }

    case ACTIONS.graphCleared:
      return {
        ...state,
        graphSnapshot: createEmptyGraph(),
      };
  }
}
