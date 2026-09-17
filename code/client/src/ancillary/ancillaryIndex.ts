import { ancillaryValues } from "./ancillaryAccess";
import { decodeLegacyMetadata } from "./legacyMetadata";
import { METADATA_TYPE_NUMBER, type LegacyCanonicalDataset, type CanonicalDataset } from "../contracts/models";
import type { AncillaryData, NumericStats } from "./ancillaryTypes";

export const EMPTY_ANCILLARY_DATA: AncillaryData = {};

const GENERATED_NUMERIC_METADATA_KEYS = ["profile_count"];

export interface AncillaryIndex {
  byNodeId: Map<string, AncillaryData>;
  categoricalInverted: Map<string, Map<string, Set<string>>>;
  numericStats: Map<string, NumericStats>;
}

export function buildAncillaryIndex(dataset: CanonicalDataset | LegacyCanonicalDataset): AncillaryIndex {
  const annotations =
    "annotationsByNodeId" in dataset
      ? dataset.annotationsByNodeId
      : Object.fromEntries(
          Object.entries(dataset.metadata_by_node_id).map(([id, values]) => [id, decodeLegacyMetadata(values)]),
        );
  const byNodeId = new Map(
    dataset.nodes.map(({ id }) => [id, annotations[id] ? ancillaryValues(annotations[id]) : {}]),
  );
  const categoricalInverted = new Map<string, Map<string, Set<string>>>();
  const numericStats = new Map<string, NumericStats>();

  for (const field of "ancillarySchema" in dataset ? dataset.ancillarySchema : dataset.metadata_schema) {
    if (field.type === METADATA_TYPE_NUMBER) {
      addNumericStats(field.key, byNodeId, numericStats);
      continue;
    }

    categoricalInverted.set(field.key, buildCategoricalInvertedIndex(field.key, byNodeId));
  }

  for (const fieldKey of GENERATED_NUMERIC_METADATA_KEYS) {
    if (!numericStats.has(fieldKey)) {
      const counts = new Map(
        dataset.nodes.map(({ id }) => [id, { profile_count: annotations[id]?.profileSummary.isolateCount ?? null }]),
      );
      addNumericStats(fieldKey, counts, numericStats);
    }
  }

  return {
    byNodeId,
    categoricalInverted,
    numericStats,
  };
}

export function getNodeAncillaryData(index: AncillaryIndex, nodeId: string): AncillaryData {
  return index.byNodeId.get(nodeId) ?? EMPTY_ANCILLARY_DATA;
}

export function filterNodeIdsByFieldValues(
  index: AncillaryIndex,
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

function buildCategoricalInvertedIndex(
  fieldKey: string,
  byNodeId: Map<string, AncillaryData>,
): Map<string, Set<string>> {
  const invertedIndex = new Map<string, Set<string>>();

  for (const [nodeId, ancillaryData] of byNodeId) {
    const value = ancillaryData[fieldKey];

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
  byNodeId: Map<string, AncillaryData>,
  numericStats: Map<string, NumericStats>,
): void {
  const stats = computeNumericStats(fieldKey, byNodeId);

  if (stats) {
    numericStats.set(fieldKey, stats);
  }
}

function computeNumericStats(fieldKey: string, byNodeId: Map<string, AncillaryData>): NumericStats | null {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;

  for (const ancillaryData of byNodeId.values()) {
    const value = ancillaryData[fieldKey];

    if (typeof value !== "number") {
      continue;
    }

    min = Math.min(min, value);
    max = Math.max(max, value);
  }

  return Number.isFinite(min) && Number.isFinite(max) ? { min, max } : null;
}
