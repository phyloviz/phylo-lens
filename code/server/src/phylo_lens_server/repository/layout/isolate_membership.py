"""Shared SQLite/PostgreSQL reads for biological profile membership."""

import json

from phylo_lens_server.domain.models import IsolateRecord


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
            IsolateRecord(
                id=row["isolate_id"], metadata=json.loads(row["metadata_json"])
            )
        )
    return {key: tuple(value) for key, value in result.items()}


def search_isolates(
    connection,
    *,
    dataset_id,
    layout_version,
    needle,
    best,
    record_match,
    placeholder="?",
):
    # Read the scoped ID index rather than JSON blobs. Python case folding keeps
    # Unicode matching identical on SQLite and PostgreSQL.
    rows = connection.execute(
        f"""select node_id, isolate_id from profile_isolates
        where dataset_id = {placeholder} and layout_version = {placeholder}
        order by isolate_id""",
        (dataset_id, layout_version),
    )
    lowered = needle.casefold()
    for row in rows:
        value = row["isolate_id"].casefold()
        if lowered not in value:
            continue
        score = 100 if value == lowered else 60 if value.startswith(lowered) else 40
        record_match(
            best, node_id=row["node_id"], score=score, matched_text=row["isolate_id"]
        )
