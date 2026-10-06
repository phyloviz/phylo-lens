"""Search values and deterministic ranking, independent of SQL and HTTP."""

import re
from collections.abc import Iterable, Mapping
from dataclasses import dataclass

from .ancillary import AncillaryValue
from .legacy_metadata import is_summary_key

SEARCH_SCORE_ID_EXACT = 100
SEARCH_SCORE_ID_PREFIX = 60
SEARCH_SCORE_ID_SUBSTRING = 40
SEARCH_SCORE_METADATA_VALUE = 20
_GENERATED_UNION_NODE_ID = re.compile(r"^union_[0-9]+(?:_[0-9]+)*$")


@dataclass(frozen=True)
class SearchQuery:
    dataset_id: str
    query: str
    limit: int = 25
    layout_version: str | None = None


@dataclass(frozen=True)
class SearchMatch:
    node_id: str
    score: int
    matched_text: str
    cluster_id: str | None = None
    x: float | None = None
    y: float | None = None


@dataclass(frozen=True)
class SearchReadResult:
    dataset_id: str
    layout_version: str
    query: str
    matches: tuple[SearchMatch, ...]
    total_count: int


@dataclass(frozen=True)
class NodeLocation:
    cluster_id: str | None = None
    x: float | None = None
    y: float | None = None


def is_generated_union_node(node_id: str) -> bool:
    return _GENERATED_UNION_NODE_ID.match(node_id) is not None


def identifier_score(value: str, needle: str) -> int:
    return (
        SEARCH_SCORE_ID_EXACT
        if value == needle
        else SEARCH_SCORE_ID_PREFIX
        if value.startswith(needle)
        else SEARCH_SCORE_ID_SUBSTRING
    )


def first_matching_value(
    values: Mapping[str, AncillaryValue], lowered_needle: str
) -> str | None:
    for key, value in values.items():
        if value is not None and not is_summary_key(key):
            text = str(value)
            if lowered_needle in text.lower():
                return text
    return None


def rank_matches(candidates: Iterable[SearchMatch]) -> tuple[SearchMatch, ...]:
    best: dict[str, SearchMatch] = {}
    for candidate in candidates:
        previous = best.get(candidate.node_id)
        if previous is None or previous.score < candidate.score:
            best[candidate.node_id] = candidate
    return tuple(sorted(best.values(), key=lambda match: (-match.score, match.node_id)))
