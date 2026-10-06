"""Shared SQLite/PostgreSQL reads for biological profile membership."""

import json

from phylo_lens_server.domain.models import Isolate
from phylo_lens_server.domain.search import SearchMatch, identifier_score


def load_isolates(connection, *, dataset_id, layout_version, node_ids, placeholder="?"):
    if not node_ids:
        return {}
    ids = sorted(node_ids)
    rows = connection.execute(
        f"""select node_id, isolate_id, metadata_json from profile_isolates
        where dataset_id = {placeholder} and layout_version = {placeholder}
        and node_id in ({",".join([placeholder] * len(ids))})
        order by node_id, isolate_id""",
        (dataset_id, layout_version, *ids),
    ).fetchall()
    result = {}
    for row in rows:
        result.setdefault(row["node_id"], []).append(
            Isolate(
                id=row["isolate_id"], ancillary_data=json.loads(row["metadata_json"])
            )
        )
    return {key: tuple(value) for key, value in result.items()}


def search_isolates(
    connection,
    *,
    dataset_id: str,
    layout_version: str,
    needle: str,
    placeholder: str = "?",
) -> tuple[SearchMatch, ...]:
    # Original isolate identifiers use Unicode case folding on both backends.
    rows = connection.execute(
        f"""select node_id, isolate_id from profile_isolates
        where dataset_id = {placeholder} and layout_version = {placeholder}
        order by isolate_id""",
        (dataset_id, layout_version),
    )
    lowered = needle.casefold()
    return tuple(
        SearchMatch(
            row["node_id"],
            identifier_score(row["isolate_id"].casefold(), lowered),
            row["isolate_id"],
        )
        for row in rows
        if lowered in row["isolate_id"].casefold()
    )
