from __future__ import annotations

from dataclasses import replace
import json
import re
import sqlite3

from phylo_lens_server.core.metadata_keys import is_internal_metadata_key
from phylo_lens_server.prepared_layout.models import SearchMatch, SearchReadResult
from phylo_lens_server.prepared_layout.store.schema import connect

SEARCH_SCORE_ID_EXACT = 100
SEARCH_SCORE_ID_PREFIX = 60
SEARCH_SCORE_ID_SUBSTRING = 40
SEARCH_SCORE_METADATA_VALUE = 20

_GENERATED_UNION_NODE_ID = re.compile(r"^union_[0-9]+(?:_[0-9]+)*$")


def search_nodes(
    database_path,
    *,
    dataset_id: str,
    layout_version: str,
    query: str,
    limit: int,
) -> SearchReadResult:
    needle = query.strip()
    if not needle:
        return SearchReadResult(
            dataset_id=dataset_id,
            layout_version=layout_version,
            query=query.strip(),
            matches=(),
            total_count=0,
        )

    with connect(database_path) as connection:
        best: dict[str, SearchMatch] = {}
        _search_by_node_id(
            connection,
            dataset_id=dataset_id,
            layout_version=layout_version,
            needle=needle,
            best=best,
        )
        _search_by_metadata_value(
            connection,
            dataset_id=dataset_id,
            layout_version=layout_version,
            needle=needle,
            best=best,
        )

        ordered = sorted(best.values(), key=lambda match: (-match.score, match.node_id))
        total_count = len(ordered)
        limited = list(ordered[:limit]) if limit >= 0 else list(ordered)
        locations = _node_locations(
            connection,
            dataset_id=dataset_id,
            layout_version=layout_version,
            node_ids=[match.node_id for match in limited],
        )
    matches = tuple(
        replace(
            match,
            cluster_id=locations.get(match.node_id, (None, None, None))[0],
            x=locations.get(match.node_id, (None, None, None))[1],
            y=locations.get(match.node_id, (None, None, None))[2],
        )
        for match in limited
    )
    return SearchReadResult(
        dataset_id=dataset_id,
        layout_version=layout_version,
        query=needle,
        matches=matches,
        total_count=total_count,
    )


def _escape_like(term: str) -> str:
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _is_union_node_id(node_id: str) -> bool:
    return _GENERATED_UNION_NODE_ID.match(node_id) is not None


def _first_matching_value(
    metadata: dict[str, str | float | bool | None], lowered_needle: str
) -> str | None:
    for key, value in metadata.items():
        if value is None or is_internal_metadata_key(key):
            continue
        text = str(value)
        if lowered_needle in text.lower():
            return text
    return None


def _search_by_node_id(
    connection: sqlite3.Connection,
    *,
    dataset_id: str,
    layout_version: str,
    needle: str,
    best: dict[str, SearchMatch],
) -> None:
    pattern = f"%{_escape_like(needle)}%"
    rows = connection.execute(
        """
        select distinct node_id
        from node_positions
        where dataset_id = ?
          and layout_version = ?
          and node_id like ? escape '\\'
        """,
        (dataset_id, layout_version, pattern),
    ).fetchall()
    lowered = needle.lower()
    for row in rows:
        node_id = row["node_id"]
        if _is_union_node_id(node_id):
            continue
        lower_id = node_id.lower()
        if lower_id == lowered:
            score = SEARCH_SCORE_ID_EXACT
        elif lower_id.startswith(lowered):
            score = SEARCH_SCORE_ID_PREFIX
        else:
            score = SEARCH_SCORE_ID_SUBSTRING
        _record_match(best, node_id=node_id, score=score, matched_text=node_id)


def _search_by_metadata_value(
    connection: sqlite3.Connection,
    *,
    dataset_id: str,
    layout_version: str,
    needle: str,
    best: dict[str, SearchMatch],
) -> None:
    pattern = f"%{_escape_like(needle)}%"
    rows = connection.execute(
        """
        select node_id, metadata_json
        from node_metadata
        where dataset_id = ?
          and layout_version = ?
          and metadata_json like ? escape '\\'
        """,
        (dataset_id, layout_version, pattern),
    ).fetchall()
    lowered = needle.lower()
    for row in rows:
        node_id = row["node_id"]
        if _is_union_node_id(node_id):
            continue
        metadata = json.loads(row["metadata_json"])
        matched_value = _first_matching_value(metadata, lowered)
        if matched_value is None:
            continue
        _record_match(
            best,
            node_id=node_id,
            score=SEARCH_SCORE_METADATA_VALUE,
            matched_text=f"{node_id} {matched_value}",
        )


def _record_match(
    best: dict[str, SearchMatch],
    *,
    node_id: str,
    score: int,
    matched_text: str,
) -> None:
    existing = best.get(node_id)
    if existing is not None and existing.score >= score:
        return
    best[node_id] = SearchMatch(
        node_id=node_id,
        score=score,
        matched_text=matched_text,
    )


def _node_locations(
    connection: sqlite3.Connection,
    *,
    dataset_id: str,
    layout_version: str,
    node_ids: list[str],
) -> dict[str, tuple[str | None, float | None, float | None]]:
    if not node_ids:
        return {}
    placeholders = ",".join("?" for _ in node_ids)
    rows = connection.execute(
        f"""
        select node_id, cluster_id, x, y
        from node_positions
        where dataset_id = ?
          and layout_version = ?
          and node_id in ({placeholders})
        """,
        (dataset_id, layout_version, *node_ids),
    ).fetchall()
    return {row["node_id"]: (row["cluster_id"], row["x"], row["y"]) for row in rows}
