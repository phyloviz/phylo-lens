import type {
  CanonicalDataset,
  SearchDatasetResponse,
} from "../../../contracts/models";

const SEARCH_TOKEN_PATTERN = /[A-Za-z0-9_]+/g;
const MIN_SEARCH_PREFIX_LENGTH = 2;

export function searchFullRenderedDataset({
  dataset,
  query,
  limit,
  includeMetadataKeys,
}: {
  dataset: CanonicalDataset;
  query: string;
  limit: number;
  includeMetadataKeys?: string[];
}): SearchDatasetResponse {
  const normalizedQuery = normalizeSearchText(query);
  const queryTokens = tokenizeSearchText(normalizedQuery);
  const scores = new Map<string, number>();

  dataset.nodes.forEach((node) => {
    const normalizedNodeId = normalizeSearchText(node.id);
    if (normalizedNodeId === normalizedQuery) {
      scores.set(node.id, (scores.get(node.id) ?? 0) + 120);
    }
  });

  if (isShortNumericSearchQuery(normalizedQuery)) {
    return buildLocalSearchResponse({
      dataset,
      query,
      scores,
      limit,
      includeMetadataKeys,
    });
  }

  dataset.nodes.forEach((node) => {
    const searchableValues = searchableValuesForNode(dataset, node.id);
    const searchableText = searchableValues.join(" ");
    const normalizedSearchableText = normalizeSearchText(searchableText);

    if (normalizedSearchableText === normalizedQuery) {
      scores.set(node.id, (scores.get(node.id) ?? 0) + 100);
    }

    const searchableTokens = tokenizeSearchText(normalizedSearchableText);
    queryTokens.forEach((queryToken) => {
      searchableTokens.forEach((searchableToken) => {
        if (searchableToken === queryToken) {
          scores.set(node.id, (scores.get(node.id) ?? 0) + 20);
          return;
        }

        if (
          queryToken.length >= MIN_SEARCH_PREFIX_LENGTH &&
          searchableToken.startsWith(queryToken)
        ) {
          scores.set(node.id, (scores.get(node.id) ?? 0) + 8);
        }
      });
    });
  });

  return buildLocalSearchResponse({
    dataset,
    query,
    scores,
    limit,
    includeMetadataKeys,
  });
}

function buildLocalSearchResponse({
  dataset,
  query,
  scores,
  limit,
  includeMetadataKeys,
}: {
  dataset: CanonicalDataset;
  query: string;
  scores: Map<string, number>;
  limit: number;
  includeMetadataKeys?: string[];
}): SearchDatasetResponse {
  const matches = [...scores.entries()]
    .sort(([leftId, leftScore], [rightId, rightScore]) => {
      return rightScore - leftScore || leftId.localeCompare(rightId);
    })
    .map(([nodeId, score]) => ({
      node_id: nodeId,
      score,
      matched_text: searchableValuesForNode(dataset, nodeId).join(" "),
      metadata: selectLocalSearchMetadata(
        dataset.metadata_by_node_id[nodeId] ?? {},
        includeMetadataKeys,
      ),
    }));

  return {
    dataset_id: dataset.dataset_id,
    query,
    matches: matches.slice(0, limit),
    total_count: matches.length,
  };
}

function searchableValuesForNode(
  dataset: CanonicalDataset,
  nodeId: string,
): string[] {
  const metadata = dataset.metadata_by_node_id[nodeId] ?? {};
  return [
    nodeId,
    ...Object.values(metadata)
      .filter((value) => value !== null && value !== undefined)
      .map(String),
  ];
}

function selectLocalSearchMetadata(
  metadata: Record<string, string | number | boolean | null>,
  includeMetadataKeys: string[] | undefined,
): Record<string, string | number | boolean | null> {
  if (!includeMetadataKeys || includeMetadataKeys.length === 0) {
    return {};
  }

  return Object.fromEntries(
    includeMetadataKeys
      .filter((key) => key in metadata)
      .map((key) => [key, metadata[key] as string | number | boolean | null]),
  );
}

function normalizeSearchText(value: string): string {
  return value.toLowerCase().trim();
}

function tokenizeSearchText(value: string): string[] {
  return value.match(SEARCH_TOKEN_PATTERN) ?? [];
}

function isShortNumericSearchQuery(normalizedQuery: string): boolean {
  return normalizedQuery.length <= 1 && /^\d$/.test(normalizedQuery);
}
