import { EMPTY_ANCILLARY_FILTER_STATE } from "../../ancillary/filterEngine";
import type { AncillaryFilterState } from "../../ancillary/ancillaryTypes";
import type { PositionedGraph } from "../../contracts/positioned";
import type { VisualMappingOptions } from "../../render/mapping/visualMapping";
import type { GraphDisplayOptions, GraphRenderer } from "../../render/renderer.types";
import { getGraphSession } from "./graphWorkbench.state";
import type { GraphWorkbenchState } from "./graphWorkbench.types";
import { createEmptyGraph } from "./viewportGraph";
import type { GraphViewportCoordinator } from "./viewport/viewportCoordinator";
import { ACTIONS, type GraphWorkbenchAction } from "./graphWorkbench.actions";

interface GraphFiltersOptions {
  getState: () => GraphWorkbenchState;
  dispatch: (action: GraphWorkbenchAction) => void;
  renderer: GraphRenderer;
  getViewportCoordinator: () => GraphViewportCoordinator | null;
}

export default function createGraphFilters({
  getState,
  dispatch,
  renderer,
  getViewportCoordinator,
}: GraphFiltersOptions) {
  return {
    applyMetadataFilters: applyMetadataFilters,
    clearMetadataFilters: clearMetadataFilters,
    updateVisualMapping: updateVisualMapping,
    updateDisplayOptions: updateDisplayOptions,
  };

  function applyMetadataFilters(filterState: AncillaryFilterState): PositionedGraph {
    return updateGraphState({
      type: ACTIONS.filtersUpdated,
      filters: filterState,
    });
  }

  function clearMetadataFilters(): PositionedGraph {
    return updateGraphState({
      type: ACTIONS.filtersUpdated,
      filters: EMPTY_ANCILLARY_FILTER_STATE,
    });
  }

  function updateVisualMapping(visualMapping: VisualMappingOptions): PositionedGraph {
    return updateGraphState({
      type: ACTIONS.visualMappingUpdated,
      visualMapping,
    });
  }

  // Apply presentation toggles (node labels, edge distance labels, distance-
  // weighted edges) to the live LoD view. The renderer rebuilds its settings,
  // while the viewport coordinator derives a new snapshot from the current slice.
  // This avoids a redundant viewport request and does not call renderer.render,
  // which would replace the live LoD graph with a stale coarse snapshot.
  function updateDisplayOptions(displayOptions: GraphDisplayOptions): void {
    dispatch({
      type: ACTIONS.displayOptionsUpdated,
      displayOptions,
    });

    renderer.updateDisplayOptions?.(displayOptions);

    getViewportCoordinator()?.updateDisplayOptions(getState().graphSession?.displayOptions ?? displayOptions);
  }

  function updateGraphState(action: GraphWorkbenchAction): PositionedGraph {
    getGraphSession(getState());

    dispatch(action);

    getViewportCoordinator()?.refreshNow();

    return currentSnapshot(getState());
  }
}

function currentSnapshot(state: GraphWorkbenchState): PositionedGraph {
  return state.graphSnapshot ?? createEmptyGraph();
}
