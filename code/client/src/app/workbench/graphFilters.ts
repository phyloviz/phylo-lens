import { EMPTY_METADATA_FILTER_STATE } from "../../ancillary/filterEngine";
import type { MetadataFilterState } from "../../ancillary/metadataTypes";
import type { PositionedGraph } from "../../contracts/positioned";
import type { VisualMappingOptions } from "../../render/mapping/visualMapping";
import type { GraphDisplayOptions, GraphRenderer } from "../../render/renderer.types";
import { requirePreparedSession } from "./graphWorkbench.state";
import type { GraphWorkbenchState } from "./graphWorkbench.types";
import { createEmptyGraph } from "./viewportGraph";

interface GraphFiltersOptions {
  state: GraphWorkbenchState;
  renderer: GraphRenderer;
}

export default function createGraphFilters({ state, renderer }: GraphFiltersOptions) {
  return {
    applyMetadataFilters: applyMetadataFilters,
    clearMetadataFilters: clearMetadataFilters,
    updateVisualMapping: updateVisualMapping,
    updateDisplayOptions: updateDisplayOptions,
  };

  function applyMetadataFilters(filterState: MetadataFilterState): PositionedGraph {
    requirePreparedSession(state);

    // Filtering is applied inside the viewport sync via getRenderSettings; the
    // refresh re-fetches the current viewport and re-runs the filter/visual pass.
    state.activeFilters = filterState;
    renderer.refreshGraphViewportSync?.();

    return currentGraph(state);
  }

  function clearMetadataFilters(): PositionedGraph {
    requirePreparedSession(state);

    state.activeFilters = EMPTY_METADATA_FILTER_STATE;
    renderer.refreshGraphViewportSync?.();

    return currentGraph(state);
  }

  function updateVisualMapping(visualMapping: VisualMappingOptions): PositionedGraph {
    const session = requirePreparedSession(state);

    // Persist the mapping so the viewport sync re-derives visuals on refresh.
    session.visualMapping = visualMapping;
    renderer.refreshGraphViewportSync?.();

    return currentGraph(state);
  }

  // Apply presentation toggles (node labels, edge distance labels, distance-
  // weighted edges) to the live LoD view. The renderer owns two concerns:
  // updateDisplayOptions rebuilds Sigma settings (so the node-label toggle takes
  // effect and the live viewer stays bound), and the persisted session options
  // are re-read by getRenderSettings on the next viewport sync, which
  // refreshGraphViewportSync forces immediately. We deliberately do NOT call
  // renderer.render() here: under LoD that clears the live viewport graph and
  // repopulates it from a stale coarse snapshot, resurfacing cluster-proxy
  // triangles and freezing the sync loop.
  function updateDisplayOptions(displayOptions: GraphDisplayOptions): void {
    if (state.preparedSession) {
      state.preparedSession.displayOptions = {
        ...state.preparedSession.displayOptions,
        ...displayOptions,
      };
    }
    renderer.updateDisplayOptions?.(displayOptions);
    renderer.refreshGraphViewportSync?.();
  }
}

function currentGraph(state: GraphWorkbenchState): PositionedGraph {
  return state.currentGraph ?? createEmptyGraph();
}
