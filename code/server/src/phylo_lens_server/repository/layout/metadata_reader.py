from __future__ import annotations

from collections import Counter
from collections.abc import Iterable
from dataclasses import replace
import json
import sqlite3

from phylo_lens_server.domain.metadata_keys import is_internal_metadata_key
from phylo_lens_server.pipeline.models import (
    LayoutStatus,
    MetadataSchemaField,
    ViewportNode,
)

MetadataValue = str | float | bool | None
MetadataMap = dict[str, MetadataValue]


def aggregate_layout_status(statuses: set[LayoutStatus]) -> LayoutStatus:
    if not statuses:
        return "pending"
    if "failed" in statuses:
        return "failed"
    if "degraded" in statuses:
        return "degraded"
    if statuses == {"ready"}:
        return "ready"
    return "refining"


def aggregate_cluster_metadata(
    member_metadata: list[MetadataMap],
    schema: tuple[tuple[str, str], ...],
) -> MetadataMap:
    aggregate: MetadataMap = {}
    for key, field_type in schema:
        value = aggregate_metadata_values(
            field_type,
            (
                metadata[key]
                for metadata in member_metadata
                if metadata.get(key) is not None
            ),
        )
        if value is not None:
            aggregate[key] = value
    return aggregate


def aggregate_render_metadata(
    member_metadata: list[MetadataMap],
    schema: tuple[tuple[str, str], ...],
) -> MetadataMap:
    """Aggregate public fields and generated render-only count fields."""
    aggregate = aggregate_cluster_metadata(member_metadata, schema)
    aggregate.update(sum_internal_count_metadata(member_metadata))
    return aggregate


def sum_internal_count_metadata(member_metadata: list[MetadataMap]) -> MetadataMap:
    totals: dict[str, float] = {}
    for metadata in member_metadata:
        for key, value in metadata.items():
            if not is_internal_metadata_key(key):
                continue
            if not isinstance(value, (int, float)) or isinstance(value, bool):
                continue
            totals[key] = totals.get(key, 0.0) + float(value)

    return {
        key: int(value) if value.is_integer() else value
        for key, value in sorted(totals.items())
        if value > 0
    }


def aggregate_metadata_values(
    field_type: str,
    values: Iterable[MetadataValue],
) -> MetadataValue:
    if field_type == "number":
        numeric = [
            value
            for value in values
            if isinstance(value, (int, float)) and not isinstance(value, bool)
        ]
        if not numeric:
            return None
        return sum(numeric) / len(numeric)

    counts = Counter(value for value in values if value is not None)
    if not counts:
        return None
    best_count = max(counts.values())
    return min(
        (value for value, count in counts.items() if count == best_count),
        key=str,
    )


def load_metadata_rows(
    connection: sqlite3.Connection,
    *,
    table: str,
    key_column: str,
    dataset_id: str,
    layout_version: str,
    keys: set[str],
) -> dict[str, MetadataMap]:
    if not keys:
        return {}
    placeholders = ",".join("?" for _ in keys)
    rows = connection.execute(
        f"""
        select {key_column} as row_key, metadata_json
        from {table}
        where dataset_id = ?
          and layout_version = ?
          and {key_column} in ({placeholders})
        """,
        (dataset_id, layout_version, *sorted(keys)),
    ).fetchall()
    return {row["row_key"]: json.loads(row["metadata_json"]) for row in rows}


def load_metadata_schema(
    connection: sqlite3.Connection,
    *,
    dataset_id: str,
    layout_version: str,
) -> tuple[MetadataSchemaField, ...]:
    rows = connection.execute(
        """
        select field_key, field_type
        from metadata_schema
        where dataset_id = ? and layout_version = ?
        order by field_key
        """,
        (dataset_id, layout_version),
    ).fetchall()
    return tuple(
        MetadataSchemaField(key=row["field_key"], type=row["field_type"])
        for row in rows
    )


def attach_node_metadata(
    connection: sqlite3.Connection,
    *,
    dataset_id: str,
    layout_version: str,
    nodes: tuple[ViewportNode, ...],
) -> tuple[ViewportNode, ...]:
    if not nodes:
        return nodes
    node_ids = {node.node_id for node in nodes if not node.is_representative}
    cluster_ids = {node.cluster_id for node in nodes if node.is_representative}
    node_metadata = load_metadata_rows(
        connection,
        table="node_metadata",
        key_column="node_id",
        dataset_id=dataset_id,
        layout_version=layout_version,
        keys=node_ids,
    )
    cluster_metadata = load_cluster_metadata(
        connection,
        dataset_id=dataset_id,
        layout_version=layout_version,
        cluster_ids=cluster_ids,
    )
    enriched: list[ViewportNode] = []
    for node in nodes:
        metadata = (
            cluster_metadata.get(node.cluster_id)
            if node.is_representative
            else node_metadata.get(node.node_id)
        )
        enriched.append(replace(node, metadata=metadata) if metadata else node)
    return tuple(enriched)


def load_cluster_metadata(
    connection: sqlite3.Connection,
    *,
    dataset_id: str,
    layout_version: str,
    cluster_ids: set[str],
) -> dict[str, MetadataMap]:
    if not cluster_ids:
        return {}
    cached = load_metadata_rows(
        connection,
        table="cluster_metadata",
        key_column="cluster_id",
        dataset_id=dataset_id,
        layout_version=layout_version,
        keys=cluster_ids,
    )
    missing_cluster_ids = cluster_ids - set(cached)
    if not missing_cluster_ids:
        return cached

    computed = compute_cluster_metadata(
        connection,
        dataset_id=dataset_id,
        layout_version=layout_version,
        cluster_ids=missing_cluster_ids,
    )
    cache_cluster_metadata(
        connection,
        dataset_id=dataset_id,
        layout_version=layout_version,
        metadata_by_cluster_id=computed,
    )
    return {**cached, **computed}


def compute_cluster_metadata(
    connection: sqlite3.Connection,
    *,
    dataset_id: str,
    layout_version: str,
    cluster_ids: set[str],
) -> dict[str, MetadataMap]:
    schema = tuple(
        (field.key, field.type)
        for field in load_metadata_schema(
            connection,
            dataset_id=dataset_id,
            layout_version=layout_version,
        )
    )
    if not schema:
        return {}

    members_by_cluster_id = load_cluster_members(
        connection,
        dataset_id=dataset_id,
        layout_version=layout_version,
        cluster_ids=cluster_ids,
    )
    member_ids = {
        node_id
        for member_ids_for_cluster in members_by_cluster_id.values()
        for node_id in member_ids_for_cluster
    }
    metadata_by_node = load_metadata_rows(
        connection,
        table="node_metadata",
        key_column="node_id",
        dataset_id=dataset_id,
        layout_version=layout_version,
        keys=member_ids,
    )

    computed: dict[str, MetadataMap] = {}
    for cluster_id, member_ids_for_cluster in members_by_cluster_id.items():
        if len(member_ids_for_cluster) == 1:
            metadata = metadata_by_node.get(member_ids_for_cluster[0], {})
        else:
            metadata = aggregate_cluster_metadata_by_node_ids(
                member_ids_for_cluster,
                metadata_by_node,
                schema,
            )
        if metadata:
            computed[cluster_id] = metadata
    return computed


def load_cluster_members(
    connection: sqlite3.Connection,
    *,
    dataset_id: str,
    layout_version: str,
    cluster_ids: set[str],
) -> dict[str, tuple[str, ...]]:
    if not cluster_ids:
        return {}
    placeholders = ",".join("?" for _ in cluster_ids)
    rows = connection.execute(
        f"""
        select cluster_id, node_id
        from cluster_members
        where dataset_id = ?
          and layout_version = ?
          and cluster_id in ({placeholders})
        order by cluster_id, node_id
        """,
        (dataset_id, layout_version, *sorted(cluster_ids)),
    ).fetchall()
    members: dict[str, list[str]] = {}
    for row in rows:
        members.setdefault(row["cluster_id"], []).append(row["node_id"])
    return {cluster_id: tuple(node_ids) for cluster_id, node_ids in members.items()}


def aggregate_cluster_metadata_by_node_ids(
    member_node_ids: tuple[str, ...],
    metadata_by_node: dict[str, MetadataMap],
    schema: tuple[tuple[str, str], ...],
) -> MetadataMap:
    return aggregate_render_metadata(
        [metadata_by_node.get(node_id, {}) for node_id in member_node_ids],
        schema,
    )


def cache_cluster_metadata(
    connection: sqlite3.Connection,
    *,
    dataset_id: str,
    layout_version: str,
    metadata_by_cluster_id: dict[str, MetadataMap],
) -> None:
    if not metadata_by_cluster_id:
        return
    connection.executemany(
        """
        insert into cluster_metadata(
            dataset_id, layout_version, cluster_id, metadata_json
        )
        values (?, ?, ?, ?)
        on conflict(dataset_id, layout_version, cluster_id) do update set
            metadata_json = excluded.metadata_json
        """,
        [
            (dataset_id, layout_version, cluster_id, json.dumps(metadata))
            for cluster_id, metadata in metadata_by_cluster_id.items()
        ],
    )
