import {
  filterNodeIdsByFieldValues,
  getNodeMetadata,
} from "./metadataIndex";
import type { MetadataIndexData } from "./metadataIndex";
import type { PositionedGraph } from "../contracts/positioned";

export interface CategoricalFieldFilter {
  fieldKey: string;
  acceptedValues: string[];
}

export interface NumericFieldFilter {
  fieldKey: string;
  min?: number;
  max?: number;
}

export interface MetadataFilterState {
  categorical: CategoricalFieldFilter[];
  numeric: NumericFieldFilter[];
}

export const EMPTY_METADATA_FILTER_STATE: MetadataFilterState = {
  categorical: [],
  numeric: [],
};

type FilterableMetadata =
  | Record<string, string | number | boolean | null>
  | null
  | undefined;

// Single source of truth for matching one node's metadata against a filter state.
export function matchesFilterState(
  metadata: FilterableMetadata,
  filterState: MetadataFilterState,
): boolean {
  for (const filter of filterState.categorical) {
    if (filter.acceptedValues.length === 0) {
      continue;
    }
    const value = metadata?.[filter.fieldKey];
    if (value === undefined || value === null) {
      return false;
    }
    if (!filter.acceptedValues.includes(String(value))) {
      return false;
    }
  }

  for (const filter of filterState.numeric) {
    const value = metadata?.[filter.fieldKey];
    if (typeof value !== "number") {
      return false;
    }
    if (filter.min !== undefined && value < filter.min) {
      return false;
    }
    if (filter.max !== undefined && value > filter.max) {
      return false;
    }
  }

  return true;
}

export interface GraphFilterEngine {
  apply(
    graph: PositionedGraph,
    metadataIndex: MetadataIndexData,
    filterState: MetadataFilterState,
  ): PositionedGraph;
}

// Local metadata filtering engine. Keep this boundary so server-side filtering can replace it later.
export class ClientGraphFilterEngine implements GraphFilterEngine {
  apply(
    graph: PositionedGraph,
    metadataIndex: MetadataIndexData,
    filterState: MetadataFilterState,
  ): PositionedGraph {
    if (!hasActiveFilters(filterState)) {
      return graph;
    }

    const selectedNodeIds = applyFilters(graph, metadataIndex, filterState);
    const filteredNodes = graph.nodes.filter((node) =>
      selectedNodeIds.has(node.id),
    );
    const filteredEdges = graph.edges.filter(
      (edge) =>
        selectedNodeIds.has(edge.source) && selectedNodeIds.has(edge.target),
    );

    return {
      ...graph,
      nodes: filteredNodes,
      edges: filteredEdges,
    };
  }
}

function applyFilters(
  graph: PositionedGraph,
  metadataIndex: MetadataIndexData,
  filterState: MetadataFilterState,
): Set<string> {
  let selectedNodeIds = new Set<string>(graph.nodes.map((node) => node.id));

  filterState.categorical.forEach((filter) => {
    if (filter.acceptedValues.length === 0) {
      return;
    }

    const matchingIds = filterNodeIdsByFieldValues(
      metadataIndex,
      filter.fieldKey,
      filter.acceptedValues,
    );
    selectedNodeIds = intersectSets(selectedNodeIds, matchingIds);
  });

  if (filterState.numeric.length > 0) {
    const numericOnly: MetadataFilterState = {
      categorical: [],
      numeric: filterState.numeric,
    };
    selectedNodeIds.forEach((nodeId) => {
      const metadata = getNodeMetadata(metadataIndex, nodeId);
      if (!matchesFilterState(metadata, numericOnly)) {
        selectedNodeIds.delete(nodeId);
      }
    });
  }

  return selectedNodeIds;
}

function intersectSets(left: Set<string>, right: Set<string>): Set<string> {
  const intersection = new Set<string>();
  left.forEach((value) => {
    if (right.has(value)) {
      intersection.add(value);
    }
  });
  return intersection;
}

export function hasActiveFilters(filterState: MetadataFilterState): boolean {
  const hasCategorical = filterState.categorical.some(
    (filter) => filter.acceptedValues.length > 0,
  );
  const hasNumeric = filterState.numeric.some(
    (filter) => filter.min !== undefined || filter.max !== undefined,
  );
  return hasCategorical || hasNumeric;
}
