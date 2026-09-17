import { filterNodeIdsByFieldValues, getNodeAncillaryData } from "./ancillaryIndex";
import type { AncillaryIndex } from "./ancillaryIndex";
import type { CategoricalFieldFilter, AncillaryFilterState, AncillaryData, NumericFieldFilter } from "./ancillaryTypes";
import type { PositionedGraph } from "../contracts/positioned";

export type GraphFilter = (
  graph: PositionedGraph,
  ancillaryIndex: AncillaryIndex,
  filterState: AncillaryFilterState,
) => PositionedGraph;

export const EMPTY_ANCILLARY_FILTER_STATE: AncillaryFilterState = {
  categorical: [],
  numeric: [],
};

export function matchesFilterState(
  ancillaryData: AncillaryData | null | undefined,
  filterState: AncillaryFilterState,
): boolean {
  return (
    matchesCategoricalFilters(ancillaryData, filterState.categorical) &&
    matchesNumericFilters(ancillaryData, filterState.numeric)
  );
}

// Local ancillaryData filtering implementation.
// This function can later be replaced by a server-side GraphFilter.
export const filterGraphByAncillaryData: GraphFilter = (graph, ancillaryIndex, filterState) => {
  if (!hasActiveFilters(filterState)) {
    return graph;
  }

  const selectedNodeIds = getMatchingNodeIds(graph, ancillaryIndex, filterState);

  return {
    ...graph,
    nodes: graph.nodes.filter((node) => selectedNodeIds.has(node.id)),
    edges: graph.edges.filter((edge) => selectedNodeIds.has(edge.source) && selectedNodeIds.has(edge.target)),
  };
};

function getMatchingNodeIds(
  graph: PositionedGraph,
  ancillaryIndex: AncillaryIndex,
  filterState: AncillaryFilterState,
): Set<string> {
  let selectedNodeIds = new Set(graph.nodes.map((node) => node.id));

  for (const filter of filterState.categorical) {
    if (filter.acceptedValues.length === 0) {
      continue;
    }

    const matchingNodeIds = filterNodeIdsByFieldValues(ancillaryIndex, filter.fieldKey, filter.acceptedValues);

    selectedNodeIds = intersectSets(selectedNodeIds, matchingNodeIds);
  }

  for (const nodeId of selectedNodeIds) {
    const ancillaryData = getNodeAncillaryData(ancillaryIndex, nodeId);

    if (!matchesNumericFilters(ancillaryData, filterState.numeric)) {
      selectedNodeIds.delete(nodeId);
    }
  }

  return selectedNodeIds;
}

function matchesCategoricalFilters(
  ancillaryData: AncillaryData | null | undefined,
  filters: CategoricalFieldFilter[],
): boolean {
  for (const filter of filters) {
    if (filter.acceptedValues.length === 0) {
      continue;
    }

    const value = ancillaryData?.[filter.fieldKey];

    if (value == null || !filter.acceptedValues.includes(String(value))) {
      return false;
    }
  }

  return true;
}

function matchesNumericFilters(
  ancillaryData: AncillaryData | null | undefined,
  filters: NumericFieldFilter[],
): boolean {
  for (const filter of filters) {
    if (filter.min == null && filter.max == null) {
      continue;
    }

    const value = ancillaryData?.[filter.fieldKey];

    if (
      typeof value !== "number" ||
      (filter.min != null && value < filter.min) ||
      (filter.max != null && value > filter.max)
    ) {
      return false;
    }
  }

  return true;
}

function intersectSets(left: Set<string>, right: Set<string>): Set<string> {
  return new Set([...left].filter((value) => right.has(value)));
}

export function hasActiveFilters(filterState: AncillaryFilterState): boolean {
  return (
    filterState.categorical.some((filter) => filter.acceptedValues.length > 0) ||
    filterState.numeric.some((filter) => filter.min != null || filter.max != null)
  );
}

/** @deprecated Use EMPTY_ANCILLARY_FILTER_STATE / filterGraphByAncillaryData. */
export const EMPTY_METADATA_FILTER_STATE = EMPTY_ANCILLARY_FILTER_STATE;
export const filterGraphByMetadata = filterGraphByAncillaryData;
