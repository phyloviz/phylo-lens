import {
  EMPTY_METADATA_FILTER_STATE,
  type GraphFilterEngine,
  type MetadataFilterState,
} from "../../../ancillary/filterEngine";
import type { PositionedGraph } from "../../../contracts/positioned";
import type { VisualMappingOptions } from "../../../render/visualMappings";
import type { GraphRenderer } from "../../../render/types";
import { ERR_NO_GRAPH_RENDERED } from "../workbenchErrors";
import { emitGraphRendered } from "../workbenchState";
import type { GraphWorkbenchState } from "../workbenchTypes";
import { renderMappedCurrentSlice } from "./graphRendering";

export interface ApplyMetadataFiltersArgs {
  state: GraphWorkbenchState;
  renderer: GraphRenderer;
  filterEngine: GraphFilterEngine;
  filterState: MetadataFilterState;
}

export function applyMetadataFilters({
  state,
  renderer,
  filterEngine,
  filterState,
}: ApplyMetadataFiltersArgs): PositionedGraph {
  if (!state.currentSliceGraph || !state.metadataIndex) {
    throw new Error(ERR_NO_GRAPH_RENDERED);
  }

  state.activeFilters = filterState;

  state.currentGraph = filterEngine.apply(
    state.currentSliceGraph,
    state.metadataIndex,
    state.activeFilters,
  );

  renderer.render(state.currentGraph);
  emitGraphRendered(state, state.currentGraph);

  return state.currentGraph;
}

export interface ClearMetadataFiltersArgs {
  state: GraphWorkbenchState;
  renderer: GraphRenderer;
}

export function clearMetadataFilters({
  state,
  renderer,
}: ClearMetadataFiltersArgs): PositionedGraph {
  if (!state.currentSliceGraph || !state.metadataIndex) {
    throw new Error(ERR_NO_GRAPH_RENDERED);
  }

  state.activeFilters = EMPTY_METADATA_FILTER_STATE;
  state.currentGraph = state.currentSliceGraph;

  renderer.render(state.currentGraph);
  emitGraphRendered(state, state.currentGraph);

  return state.currentGraph;
}

export interface UpdateVisualMappingArgs {
  state: GraphWorkbenchState;
  renderer: GraphRenderer;
  filterEngine: GraphFilterEngine;
  visualMapping: VisualMappingOptions;
}

export function updateVisualMapping({
  state,
  renderer,
  filterEngine,
  visualMapping,
}: UpdateVisualMappingArgs): PositionedGraph {
  if (!state.currentSliceDataset || !state.currentPositionedSliceGraph) {
    throw new Error(ERR_NO_GRAPH_RENDERED);
  }

  if (state.preparedSession) {
    state.preparedSession.visualMapping = visualMapping;
  }

  return renderMappedCurrentSlice({
    state,
    renderer,
    filterEngine,
    visualMapping,
  });
}
