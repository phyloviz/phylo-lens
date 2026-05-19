import {
  METADATA_TYPE_NUMBER,
} from "../contracts/models";
import type { CanonicalDataset, MetadataField } from "../contracts/models";

export const EMPTY_METADATA_RECORD = {} as Record<
  string,
  string | number | boolean | null
>;

export interface NumericStats {
  min: number;
  max: number;
}

export interface MetadataIndexData {
  byNodeId: Map<string, Record<string, string | number | boolean | null>>;
  categoricalInverted: Map<string, Map<string, Set<string>>>;
  numericStats: Map<string, NumericStats>;
}

// Build fast lookup indexes for metadata filtering and visual mapping.
export function buildMetadataIndex(
  dataset: CanonicalDataset,
): MetadataIndexData {
  const byNodeId = new Map<
    string,
    Record<string, string | number | boolean | null>
  >();
  const categoricalInverted = new Map<string, Map<string, Set<string>>>();
  const numericStats = new Map<string, NumericStats>();

  dataset.nodes.forEach((node) => {
    const metadata =
      dataset.metadata_by_node_id[node.id] ?? EMPTY_METADATA_RECORD;
    byNodeId.set(node.id, metadata);
  });

  dataset.metadata_schema.forEach((field) => {
    if (field.type === METADATA_TYPE_NUMBER) {
      const stats = computeNumericStats(field, byNodeId);
      if (stats) {
        numericStats.set(field.key, stats);
      }
      return;
    }

    categoricalInverted.set(
      field.key,
      buildCategoricalInvertedIndex(field, byNodeId),
    );
  });

  return { byNodeId, categoricalInverted, numericStats };
}

// Return per-node metadata with O(1) access.
export function getNodeMetadata(
  index: MetadataIndexData,
  nodeId: string,
): Record<string, string | number | boolean | null> {
  return index.byNodeId.get(nodeId) ?? EMPTY_METADATA_RECORD;
}

// Filter nodes by exact match against one metadata field.
export function filterNodeIdsByFieldValues(
  index: MetadataIndexData,
  fieldKey: string,
  acceptedValues: string[],
): Set<string> {
  const fieldMap = index.categoricalInverted.get(fieldKey);
  if (!fieldMap || acceptedValues.length === 0) {
    return new Set<string>();
  }

  const result = new Set<string>();
  acceptedValues.forEach((value) => {
    const ids = fieldMap.get(value);
    if (!ids) {
      return;
    }
    ids.forEach((id) => result.add(id));
  });

  return result;
}

// Build an inverted index map value -> node ids for one field.
function buildCategoricalInvertedIndex(
  field: MetadataField,
  byNodeId: Map<string, Record<string, string | number | boolean | null>>,
): Map<string, Set<string>> {
  const inverted = new Map<string, Set<string>>();

  byNodeId.forEach((metadata, nodeId) => {
    const value = metadata[field.key];
    if (value === undefined || value === null) {
      return;
    }

    const normalizedValue = String(value);
    const existingSet = inverted.get(normalizedValue) ?? new Set<string>();
    existingSet.add(nodeId);
    inverted.set(normalizedValue, existingSet);
  });

  return inverted;
}

// Compute numeric min and max for one metadata field.
function computeNumericStats(
  field: MetadataField,
  byNodeId: Map<string, Record<string, string | number | boolean | null>>,
): NumericStats | null {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  byNodeId.forEach((metadata) => {
    const rawValue = metadata[field.key];
    if (typeof rawValue !== "number") {
      return;
    }

    min = Math.min(min, rawValue);
    max = Math.max(max, rawValue);
  });

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return null;
  }

  return { min, max };
}
