from __future__ import annotations

from collections import Counter
from dataclasses import replace
import json
import sqlite3

from phylo_lens_server.prepared_layout.models import (
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
        values = [
            metadata[key]
            for metadata in member_metadata
            if metadata.get(key) is not None
        ]
        if not values:
            continue
        if field_type == "number":
            numeric = [
                value
                for value in values
                if isinstance(value, (int, float)) and not isinstance(value, bool)
            ]
            if numeric:
                aggregate[key] = sum(numeric) / len(numeric)
            continue
        counts = Counter(values)
        best_count = max(counts.values())
        aggregate[key] = min(
            (value for value, count in counts.items() if count == best_count),
            key=str,
        )
    return aggregate


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
    cluster_metadata = load_metadata_rows(
        connection,
        table="cluster_metadata",
        key_column="cluster_id",
        dataset_id=dataset_id,
        layout_version=layout_version,
        keys=cluster_ids,
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
