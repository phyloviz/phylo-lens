import { buildMetadataIndex } from "../../../ancillary/metadataIndex";
import {
  hasActiveFilters,
  type GraphFilterEngine,
} from "../../../ancillary/filterEngine";
import { applyVisualMappings } from "../../../render/visualMappings";
import type { VisualMappingOptions } from "../../../render/visualMappings";
import type { GraphRenderer } from "../../../render/types";
import type { PositionedGraph } from "../../../contracts/positioned";
import { ERR_NO_GRAPH_RENDERED } from "../workbenchErrors";
import { emitGraphRendered } from "../workbenchState";
import type { GraphWorkbenchState } from "../workbenchTypes";

export interface RenderMappedCurrentSliceArgs {
  state: GraphWorkbenchState;
  renderer: GraphRenderer;
  filterEngine: GraphFilterEngine;
  visualMapping?: VisualMappingOptions;
}

export function renderMappedCurrentSlice({
  state,
  renderer,
  filterEngine,
  visualMapping,
}: RenderMappedCurrentSliceArgs): PositionedGraph {
  if (!state.currentSliceDataset || !state.currentPositionedSliceGraph) {
    throw new Error(ERR_NO_GRAPH_RENDERED);
  }

  const metadataIndex = buildMetadataIndex(state.currentSliceDataset);
  const mappedGraph = applyVisualMappings(
    state.currentPositionedSliceGraph,
    state.currentSliceDataset,
    metadataIndex,
    visualMapping,
  );

  state.currentSliceGraph = mappedGraph;
  state.currentGraph = hasActiveFilters(state.activeFilters)
    ? filterEngine.apply(mappedGraph, metadataIndex, state.activeFilters)
    : mappedGraph;
  state.metadataIndex = metadataIndex;

  renderer.render(state.currentGraph);
  emitGraphRendered(state, state.currentGraph);

  return state.currentGraph;
}
