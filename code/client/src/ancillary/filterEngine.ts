import { filterNodeIdsByFieldValues, getNodeMetadata } from "./metadataIndex";
import type { MetadataIndexData } from "./metadataIndex";
import type {
  CategoricalFieldFilter,
  MetadataFilterState,
  NodeMetadata,
  NumericFieldFilter,
} from "./metadataTypes";
import type { PositionedGraph } from "../contracts/positioned";

export type GraphFilter = (
  graph: PositionedGraph,
  metadataIndex: MetadataIndexData,
  filterState: MetadataFilterState,
) => PositionedGraph;

export const EMPTY_METADATA_FILTER_STATE: MetadataFilterState = {
  categorical: [],
  numeric: [],
};

export function matchesFilterState(
  metadata: NodeMetadata | null | undefined,
  filterState: MetadataFilterState,
): boolean {
  return (
    matchesCategoricalFilters(metadata, filterState.categorical) &&
    matchesNumericFilters(metadata, filterState.numeric)
  );
}

// Local metadata filtering implementation.
// This function can later be replaced by a server-side GraphFilter.
export const filterGraphByMetadata: GraphFilter = (
  graph,
  metadataIndex,
  filterState,
) => {
  if (!hasActiveFilters(filterState)) {
    return graph;
  }

  const selectedNodeIds = getMatchingNodeIds(graph, metadataIndex, filterState);

  return {
    ...graph,
    nodes: graph.nodes.filter((node) => selectedNodeIds.has(node.id)),
    edges: graph.edges.filter(
      (edge) =>
        selectedNodeIds.has(edge.source) && selectedNodeIds.has(edge.target),
    ),
  };
};

function getMatchingNodeIds(
  graph: PositionedGraph,
  metadataIndex: MetadataIndexData,
  filterState: MetadataFilterState,
): Set<string> {
  let selectedNodeIds = new Set(graph.nodes.map((node) => node.id));

  for (const filter of filterState.categorical) {
    if (filter.acceptedValues.length === 0) {
      continue;
    }

    const matchingNodeIds = filterNodeIdsByFieldValues(
      metadataIndex,
      filter.fieldKey,
      filter.acceptedValues,
    );

    selectedNodeIds = intersectSets(selectedNodeIds, matchingNodeIds);
  }

  for (const nodeId of selectedNodeIds) {
    const metadata = getNodeMetadata(metadataIndex, nodeId);

    if (!matchesNumericFilters(metadata, filterState.numeric)) {
      selectedNodeIds.delete(nodeId);
    }
  }

  return selectedNodeIds;
}

function matchesCategoricalFilters(
  metadata: NodeMetadata | null | undefined,
  filters: CategoricalFieldFilter[],
): boolean {
  for (const filter of filters) {
    if (filter.acceptedValues.length === 0) {
      continue;
    }

    const value = metadata?.[filter.fieldKey];

    if (value == null || !filter.acceptedValues.includes(String(value))) {
      return false;
    }
  }

  return true;
}

function matchesNumericFilters(
  metadata: NodeMetadata | null | undefined,
  filters: NumericFieldFilter[],
): boolean {
  for (const filter of filters) {
    if (filter.min == null && filter.max == null) {
      continue;
    }

    const value = metadata?.[filter.fieldKey];

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

export function hasActiveFilters(filterState: MetadataFilterState): boolean {
  return (
    filterState.categorical.some(
      (filter) => filter.acceptedValues.length > 0,
    ) ||
    filterState.numeric.some(
      (filter) => filter.min != null || filter.max != null,
    )
  );
}
