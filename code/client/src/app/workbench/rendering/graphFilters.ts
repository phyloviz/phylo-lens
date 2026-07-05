import {
  EMPTY_METADATA_FILTER_STATE,
  type MetadataFilterState,
} from "../../../ancillary/filterEngine";
import type { PositionedGraph } from "../../../contracts/positioned";
import type { VisualMappingOptions } from "../../../render/visualMappings";
import type { GraphRenderer } from "../../../render/types";
import { emptyGraph } from "../graphSlice";
import { ERR_NO_GRAPH_RENDERED } from "../workbenchErrors";
import type { GraphWorkbenchState } from "../workbenchTypes";

export interface ApplyMetadataFiltersArgs {
  state: GraphWorkbenchState;
  renderer: GraphRenderer;
  filterState: MetadataFilterState;
}

export function applyMetadataFilters({
  state,
  renderer,
  filterState,
}: ApplyMetadataFiltersArgs): PositionedGraph {
  if (!state.preparedSession || state.renderMode !== "lod") {
    throw new Error(ERR_NO_GRAPH_RENDERED);
  }

  // Filtering is applied inside the viewport sync via getRenderSettings; the
  // refresh re-fetches the current viewport and re-runs the filter/visual pass.
  state.activeFilters = filterState;
  renderer.refreshGraphViewportSync?.();

  return state.currentGraph ?? emptyGraph();
}

export interface ClearMetadataFiltersArgs {
  state: GraphWorkbenchState;
  renderer: GraphRenderer;
}

export function clearMetadataFilters({
  state,
  renderer,
}: ClearMetadataFiltersArgs): PositionedGraph {
  if (!state.preparedSession || state.renderMode !== "lod") {
    throw new Error(ERR_NO_GRAPH_RENDERED);
  }

  state.activeFilters = EMPTY_METADATA_FILTER_STATE;
  renderer.refreshGraphViewportSync?.();

  return state.currentGraph ?? emptyGraph();
}

export interface UpdateVisualMappingArgs {
  state: GraphWorkbenchState;
  renderer: GraphRenderer;
  visualMapping: VisualMappingOptions;
}

export function updateVisualMapping({
  state,
  renderer,
  visualMapping,
}: UpdateVisualMappingArgs): PositionedGraph {
  if (!state.preparedSession || state.renderMode !== "lod") {
    throw new Error(ERR_NO_GRAPH_RENDERED);
  }

  // Persist the mapping so the viewport sync re-derives visuals on refresh.
  state.preparedSession.visualMapping = visualMapping;
  renderer.refreshGraphViewportSync?.();

  return state.currentGraph ?? emptyGraph();
}
