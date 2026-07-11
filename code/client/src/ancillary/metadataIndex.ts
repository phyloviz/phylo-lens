import {
  METADATA_TYPE_NUMBER,
  type CanonicalDataset,
} from "../contracts/models";
import type { NodeMetadata, NumericStats } from "./metadataTypes";

export const EMPTY_METADATA_RECORD: NodeMetadata = {};

const GENERATED_NUMERIC_METADATA_KEYS = ["profile_count"];

export interface MetadataIndexData {
  byNodeId: Map<string, NodeMetadata>;
  categoricalInverted: Map<string, Map<string, Set<string>>>;
  numericStats: Map<string, NumericStats>;
}

export function buildMetadataIndex(
  dataset: CanonicalDataset,
): MetadataIndexData {
  const byNodeId = buildMetadataByNodeId(dataset);
  const categoricalInverted = new Map<string, Map<string, Set<string>>>();
  const numericStats = new Map<string, NumericStats>();

  for (const field of dataset.metadata_schema) {
    if (field.type === METADATA_TYPE_NUMBER) {
      addNumericStats(field.key, byNodeId, numericStats);
      continue;
    }

    categoricalInverted.set(
      field.key,
      buildCategoricalInvertedIndex(field.key, byNodeId),
    );
  }

  for (const fieldKey of GENERATED_NUMERIC_METADATA_KEYS) {
    if (!numericStats.has(fieldKey)) {
      addNumericStats(fieldKey, byNodeId, numericStats);
    }
  }

  return {
    byNodeId,
    categoricalInverted,
    numericStats,
  };
}

export function getNodeMetadata(
  index: MetadataIndexData,
  nodeId: string,
): NodeMetadata {
  return index.byNodeId.get(nodeId) ?? EMPTY_METADATA_RECORD;
}

export function filterNodeIdsByFieldValues(
  index: MetadataIndexData,
  fieldKey: string,
  acceptedValues: string[],
): Set<string> {
  const fieldIndex = index.categoricalInverted.get(fieldKey);

  if (!fieldIndex || acceptedValues.length === 0) {
    return new Set();
  }

  const matchingNodeIds = new Set<string>();

  for (const value of acceptedValues) {
    const nodeIds = fieldIndex.get(value);

    if (!nodeIds) {
      continue;
    }

    for (const nodeId of nodeIds) {
      matchingNodeIds.add(nodeId);
    }
  }

  return matchingNodeIds;
}

function buildMetadataByNodeId(
  dataset: CanonicalDataset,
): Map<string, NodeMetadata> {
  return new Map(
    dataset.nodes.map((node) => [
      node.id,
      dataset.metadata_by_node_id[node.id] ?? EMPTY_METADATA_RECORD,
    ]),
  );
}

function buildCategoricalInvertedIndex(
  fieldKey: string,
  byNodeId: Map<string, NodeMetadata>,
): Map<string, Set<string>> {
  const invertedIndex = new Map<string, Set<string>>();

  for (const [nodeId, metadata] of byNodeId) {
    const value = metadata[fieldKey];

    if (value == null) {
      continue;
    }

    const normalizedValue = String(value);
    const nodeIds = invertedIndex.get(normalizedValue) ?? new Set<string>();

    nodeIds.add(nodeId);
    invertedIndex.set(normalizedValue, nodeIds);
  }

  return invertedIndex;
}

function addNumericStats(
  fieldKey: string,
  byNodeId: Map<string, NodeMetadata>,
  numericStats: Map<string, NumericStats>,
): void {
  const stats = computeNumericStats(fieldKey, byNodeId);

  if (stats) {
    numericStats.set(fieldKey, stats);
  }
}

function computeNumericStats(
  fieldKey: string,
  byNodeId: Map<string, NodeMetadata>,
): NumericStats | null {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (const metadata of byNodeId.values()) {
    const value = metadata[fieldKey];

    if (typeof value !== "number") {
      continue;
    }

    min = Math.min(min, value);
    max = Math.max(max, value);
  }

  return Number.isFinite(min) && Number.isFinite(max) ? { min, max } : null;
}
