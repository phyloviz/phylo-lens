"""Publish metadata replacements while reusing immutable prepared geometry.

SQL here uses only syntax common to SQLite and PostgreSQL. The caller owns the
connection and transaction; no partially copied version is ever published.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Iterable
from datetime import UTC, datetime
from itertools import groupby
from typing import Any

from phylo_lens_server.data.normalizer import AncillaryMetadata
from phylo_lens_server.repository.layout.metadata_reader import (
    aggregate_cluster_metadata_by_node_ids,
)
from phylo_lens_server.repository.layout.writer import (
    PRECOMPUTED_CLUSTER_METADATA_TIERS,
)


class AncillaryLayoutNotFoundError(LookupError):
    """The exact source version is missing or is not published."""


# Explicit columns keep geometry copying reviewable and exclude publication dates.
GEOMETRY_COLUMNS = {
    "prepared_clusters": (
        "cluster_id, threshold, representative_node_id, member_count, "
        "x, y, radius, min_x, max_x, min_y, max_y, status"
    ),
    "cluster_members": "cluster_id, node_id",
    "graph_edges": "edge_id, source_node_id, target_node_id, distance",
    "prepared_edges": "lod_level, edge_id, source_node_id, target_node_id, distance",
    "node_positions": "cluster_id, node_id, x, y, status",
}


def published_node_ids(
    connection: Any, dataset_id: str, version: str, placeholder: str
) -> set[str]:
    require_published(connection, dataset_id, version, placeholder)
    rows = connection.execute(
        f"""select distinct node_id from node_positions
            where dataset_id = {placeholder} and layout_version = {placeholder}""",
        (dataset_id, version),
    ).fetchall()
    return {row["node_id"] for row in rows}


def require_published(
    connection: Any, dataset_id: str, version: str, placeholder: str
) -> str:
    row = connection.execute(
        f"""select status from datasets
            where dataset_id = {placeholder} and layout_version = {placeholder}""",
        (dataset_id, version),
    ).fetchone()
    if row is None or row["status"] not in ("ready", "degraded"):
        raise AncillaryLayoutNotFoundError(version)
    return row["status"]


def publish_revision(
    connection: Any,
    dataset_id: str,
    source_version: str,
    metadata: AncillaryMetadata,
    placeholder: str,
) -> str:
    status = require_published(connection, dataset_id, source_version, placeholder)
    fields = tuple((field.key, str(field.type)) for field in metadata.schema)
    payload = json.dumps(
        [
            "ancillary-replacement-v1",
            dataset_id,
            source_version,
            fields,
            metadata.by_node_id,
        ],
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    )
    version = hashlib.sha256(payload.encode()).hexdigest()
    p = placeholder
    # Concurrent identical requests converge on one complete immutable result.
    timestamp = datetime.now(UTC).isoformat(sep=" ", timespec="microseconds")
    inserted = connection.execute(
        f"""insert into datasets(dataset_id, layout_version, status, created_at, updated_at)
            values ({p}, {p}, {p}, {p}, {p})
            on conflict do nothing returning layout_version""",
        (dataset_id, version, status, timestamp, timestamp),
    ).fetchone()
    if inserted is None:
        require_published(connection, dataset_id, version, p)
        return version

    for table, columns in GEOMETRY_COLUMNS.items():
        connection.execute(
            f"""insert into {table}(dataset_id, layout_version, {columns})
                select dataset_id, {p}, {columns} from {table}
                where dataset_id = {p} and layout_version = {p}""",
            (version, dataset_id, source_version),
        )
    _insert_many(
        connection,
        f"""insert into metadata_schema(dataset_id, layout_version, field_key, field_type)
            values ({p}, {p}, {p}, {p})""",
        ((dataset_id, version, key, field_type) for key, field_type in fields),
    )
    _insert_many(
        connection,
        f"""insert into node_metadata(dataset_id, layout_version, node_id, metadata_json)
            values ({p}, {p}, {p}, {p})""",
        (
            (dataset_id, version, node_id, json.dumps(values))
            for node_id, values in metadata.by_node_id.items()
        ),
    )
    # Match preparation's precomputation budget. Other tiers aggregate lazily.
    rows = connection.execute(
        f"""select m.cluster_id, m.node_id from cluster_members m
            join prepared_clusters c
              on c.dataset_id = m.dataset_id and c.layout_version = m.layout_version
             and c.cluster_id = m.cluster_id
            where m.dataset_id = {p} and m.layout_version = {p}
              and c.threshold in (
                select distinct threshold from prepared_clusters
                where dataset_id = {p} and layout_version = {p} and threshold is not null
                order by threshold desc limit {PRECOMPUTED_CLUSTER_METADATA_TIERS}
              )
            order by m.cluster_id, m.node_id""",
        (dataset_id, version, dataset_id, version),
    )

    def summaries():
        for cluster_id, members in groupby(rows, key=lambda row: row["cluster_id"]):
            yield (
                cluster_id,
                aggregate_cluster_metadata_by_node_ids(
                    tuple(row["node_id"] for row in members),
                    metadata.by_node_id,
                    fields,
                ),
            )

    _insert_many(
        connection,
        f"""insert into cluster_metadata(dataset_id, layout_version, cluster_id, metadata_json)
            values ({p}, {p}, {p}, {p})""",
        (
            (dataset_id, version, cluster_id, json.dumps(values))
            for cluster_id, values in summaries()
        ),
    )
    connection.execute(
        f"update datasets set updated_at = {p} where dataset_id = {p} and layout_version = {p}",
        (
            datetime.now(UTC).isoformat(sep=" ", timespec="microseconds"),
            dataset_id,
            version,
        ),
    )
    return version


def _insert_many(connection: Any, sql: str, rows: Iterable[tuple[Any, ...]]) -> None:
    cursor = connection.cursor()
    try:
        cursor.executemany(sql, rows)
    finally:
        cursor.close()
