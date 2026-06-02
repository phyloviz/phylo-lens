from __future__ import annotations

import re
from collections import defaultdict

from phylo_lens_server.core.models import (
    CanonicalDataset,
    PreparedSearchIndex,
    SearchDatasetMatch,
    SearchDatasetQuery,
    SearchDatasetResponse,
)

TOKEN_PATTERN = re.compile(r"[A-Za-z0-9_]+")
MIN_PREFIX_LENGTH = 2
MAX_PREFIX_LENGTH = 32


def build_prepared_search_index(dataset: CanonicalDataset) -> PreparedSearchIndex:
    """Build compact lookup tables for prepared-dataset search."""
    exact: dict[str, set[str]] = defaultdict(set)
    prefixes: dict[str, set[str]] = defaultdict(set)
    text_by_node_id: dict[str, str] = {}

    for node in dataset.nodes:
        metadata = dataset.metadata_by_node_id.get(node.id, {})
        searchable_values = [node.id]
        searchable_values.extend(str(value) for value in metadata.values() if value is not None)
        searchable_text = " ".join(searchable_values)
        normalized_text = normalize_search_text(searchable_text)
        text_by_node_id[node.id] = searchable_text

        for token in tokenize(normalized_text):
            exact[token].add(node.id)
            for prefix in token_prefixes(token):
                prefixes[prefix].add(node.id)

        exact[normalize_search_text(node.id)].add(node.id)

    return PreparedSearchIndex(
        node_ids_by_exact_text=freeze_index(exact, min_key_length=1),
        node_ids_by_prefix=freeze_index(prefixes),
        searchable_text_by_node_id=text_by_node_id,
        metadata_by_node_id=dataset.metadata_by_node_id,
    )


def search_prepared_index(
    dataset_id: str,
    query: SearchDatasetQuery,
    index: PreparedSearchIndex,
) -> SearchDatasetResponse:
    normalized_query = normalize_search_text(query.query)
    query_tokens = tokenize(normalized_query)
    scores: dict[str, float] = defaultdict(float)

    if normalized_query in index.node_ids_by_exact_text:
        for node_id in index.node_ids_by_exact_text[normalized_query]:
            scores[node_id] += 100.0

    for token in query_tokens:
        for node_id in index.node_ids_by_exact_text.get(token, []):
            scores[node_id] += 20.0
        for node_id in index.node_ids_by_prefix.get(token, []):
            scores[node_id] += 8.0

    if not scores:
        return SearchDatasetResponse(
            dataset_id=dataset_id,
            query=query.query,
            matches=[],
            total_count=0,
        )

    matches = [
        SearchDatasetMatch(
            node_id=node_id,
            score=score,
            matched_text=index.searchable_text_by_node_id.get(node_id, node_id),
            metadata=selected_metadata(
                index.metadata_by_node_id.get(node_id, {}),
                query.include_metadata_keys,
            ),
        )
        for node_id, score in sorted(
            scores.items(),
            key=lambda item: (-item[1], item[0]),
        )
    ]

    return SearchDatasetResponse(
        dataset_id=dataset_id,
        query=query.query,
        matches=matches[: query.limit],
        total_count=len(matches),
    )


def normalize_search_text(value: str) -> str:
    return value.casefold().strip()


def tokenize(value: str) -> list[str]:
    return TOKEN_PATTERN.findall(value)


def token_prefixes(token: str) -> list[str]:
    upper_bound = min(len(token), MAX_PREFIX_LENGTH)
    return [
        token[:prefix_length]
        for prefix_length in range(MIN_PREFIX_LENGTH, upper_bound + 1)
    ]


def freeze_index(
    index: dict[str, set[str]],
    *,
    min_key_length: int = MIN_PREFIX_LENGTH,
) -> dict[str, list[str]]:
    return {
        key: sorted(node_ids)
        for key, node_ids in sorted(index.items())
        if len(key) >= min_key_length
    }


def selected_metadata(
    metadata: dict[str, str | float | bool | None],
    include_keys: list[str],
) -> dict[str, str | float | bool | None]:
    if not include_keys:
        return {}

    return {key: metadata[key] for key in include_keys if key in metadata}
