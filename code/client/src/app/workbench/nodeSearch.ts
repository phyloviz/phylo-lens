import type {
  SearchDatasetMatch,
  SearchDatasetResponse,
} from "../../contracts/models";
import { isCategoryCountMetadataKey } from "../../render/pieMapping";
import { isUnionNode } from "../../render/unionNodes";

// Generated numeric key that must never surface as a searchable field.
const PROFILE_COUNT_KEY = "profile_count";

// Relevance tiers (higher = better). A node id hit always outranks a match that
// only came from a metadata value.
const SCORE_ID_EXACT = 100;
const SCORE_ID_PREFIX = 60;
const SCORE_ID_SUBSTRING = 40;
const SCORE_METADATA_VALUE = 20;

export interface NodeSearchQuery {
  query: string;
  limit?: number;
  includeMetadataKeys?: string[];
}

type MetadataRecord = Record<string, string | number | boolean | null>;

function isSearchableMetadataKey(key: string): boolean {
  return key !== PROFILE_COUNT_KEY && !isCategoryCountMetadataKey(key);
}

// Score a single node against the lower-cased needle, returning the best match
// found or null when the node does not match at all.
function scoreNode(
  nodeId: string,
  metadata: MetadataRecord,
  needle: string,
  includeKeys: Set<string> | null,
): { score: number; matchedText: string } | null {
  const lowerId = nodeId.toLowerCase();

  if (lowerId === needle) {
    return { score: SCORE_ID_EXACT, matchedText: nodeId };
  }
  if (lowerId.startsWith(needle)) {
    return { score: SCORE_ID_PREFIX, matchedText: nodeId };
  }

  let best: { score: number; matchedText: string } | null =
    lowerId.includes(needle)
      ? { score: SCORE_ID_SUBSTRING, matchedText: nodeId }
      : null;

  for (const [key, value] of Object.entries(metadata)) {
    if (value === null || !isSearchableMetadataKey(key)) {
      continue;
    }
    if (includeKeys && !includeKeys.has(key)) {
      continue;
    }
    const text = String(value);
    if (text.toLowerCase().includes(needle)) {
      const matchedText = `${nodeId} ${text}`;
      if (best === null || SCORE_METADATA_VALUE > best.score) {
        best = { score: SCORE_METADATA_VALUE, matchedText };
      }
    }
  }

  return best;
}

// Search every loaded node (by id and metadata value) for a case-insensitive
// substring match. Union junction nodes are never surfaced as results.
export function searchDatasetNodes(
  datasetId: string,
  metadataByNodeId: Record<string, MetadataRecord>,
  query: NodeSearchQuery,
): SearchDatasetResponse {
  const rawQuery = query.query.trim();
  const needle = rawQuery.toLowerCase();

  if (needle.length === 0) {
    return { dataset_id: datasetId, query: rawQuery, matches: [], total_count: 0 };
  }

  const includeKeys =
    query.includeMetadataKeys && query.includeMetadataKeys.length > 0
      ? new Set(query.includeMetadataKeys)
      : null;

  const scored: SearchDatasetMatch[] = [];
  for (const [nodeId, metadata] of Object.entries(metadataByNodeId)) {
    // Skip union junctions and any node whose id is itself an internal key.
    if (isUnionNode(nodeId, metadata) || !isSearchableMetadataKey(nodeId)) {
      continue;
    }
    const hit = scoreNode(nodeId, metadata, needle, includeKeys);
    if (hit === null) {
      continue;
    }
    scored.push({
      node_id: nodeId,
      score: hit.score,
      matched_text: hit.matchedText,
      metadata,
    });
  }

  scored.sort((a, b) =>
    b.score !== a.score ? b.score - a.score : a.node_id.localeCompare(b.node_id),
  );

  const totalCount = scored.length;
  const limit =
    typeof query.limit === "number" && query.limit >= 0
      ? query.limit
      : undefined;
  const matches = limit === undefined ? scored : scored.slice(0, limit);

  return {
    dataset_id: datasetId,
    query: rawQuery,
    matches,
    total_count: totalCount,
  };
}
