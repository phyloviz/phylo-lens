"""Shared search retrieval; SQL dialect differences are explicit arguments."""

import json
from dataclasses import replace
from itertools import chain
from typing import Literal

from phylo_lens_server.domain.search import (
    SEARCH_SCORE_METADATA_VALUE,
    NodeLocation,
    SearchMatch,
    SearchReadResult,
    first_matching_value,
    identifier_score,
    is_generated_union_node,
    rank_matches,
)

from .isolate_membership import search_isolates


def search_nodes(
    connection,
    *,
    dataset_id: str,
    layout_version: str,
    query: str,
    limit: int,
    placeholder: str = "?",
    like_operator: Literal["like", "ilike"] = "like",
) -> SearchReadResult:
    needle = query.strip()
    if not needle:
        return SearchReadResult(dataset_id, layout_version, needle, (), 0)
    p = placeholder
    pattern = (
        "%" + needle.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
    )
    parameters = (dataset_id, layout_version, pattern)
    id_rows = connection.execute(
        f"""select distinct node_id from node_positions
        where dataset_id = {p} and layout_version = {p}
        and node_id {like_operator} {p} escape '\\'""",
        parameters,
    ).fetchall()
    lowered = needle.lower()
    id_matches = (
        SearchMatch(
            row["node_id"],
            identifier_score(row["node_id"].lower(), lowered),
            row["node_id"],
        )
        for row in id_rows
        if not is_generated_union_node(row["node_id"])
    )
    ancillary_rows = connection.execute(
        f"""select node_id, metadata_json from node_metadata
        where dataset_id = {p} and layout_version = {p}
        and metadata_json {like_operator} {p} escape '\\'""",
        parameters,
    ).fetchall()
    ancillary_matches = []
    for row in ancillary_rows:
        if is_generated_union_node(row["node_id"]):
            continue
        value = first_matching_value(json.loads(row["metadata_json"]), lowered)
        if value is not None:
            ancillary_matches.append(
                SearchMatch(
                    row["node_id"],
                    SEARCH_SCORE_METADATA_VALUE,
                    f"{row['node_id']} {value}",
                )
            )
    ordered = rank_matches(
        chain(
            id_matches,
            ancillary_matches,
            search_isolates(
                connection,
                dataset_id=dataset_id,
                layout_version=layout_version,
                needle=needle,
                placeholder=p,
            ),
        )
    )
    limited = ordered[:limit] if limit >= 0 else ordered
    locations = node_locations(
        connection,
        dataset_id=dataset_id,
        layout_version=layout_version,
        node_ids=tuple(match.node_id for match in limited),
        placeholder=p,
    )
    matches = []
    for match in limited:
        location = locations.get(match.node_id, NodeLocation())
        matches.append(
            replace(match, cluster_id=location.cluster_id, x=location.x, y=location.y)
        )
    return SearchReadResult(
        dataset_id, layout_version, needle, tuple(matches), len(ordered)
    )


def node_locations(
    connection,
    *,
    dataset_id: str,
    layout_version: str,
    node_ids: tuple[str, ...],
    placeholder: str,
) -> dict[str, NodeLocation]:
    if not node_ids:
        return {}
    p = placeholder
    predicate = (
        "node_id = any(%s)"
        if p == "%s"
        else f"node_id in ({','.join([p] * len(node_ids))})"
    )
    parameters = (
        (dataset_id, layout_version, list(node_ids))
        if p == "%s"
        else (dataset_id, layout_version, *node_ids)
    )
    rows = connection.execute(
        f"""select node_id, cluster_id, x, y from node_positions
        where dataset_id = {p} and layout_version = {p}
        and {predicate}""",
        parameters,
    ).fetchall()
    return {
        row["node_id"]: NodeLocation(row["cluster_id"], row["x"], row["y"])
        for row in rows
    }
