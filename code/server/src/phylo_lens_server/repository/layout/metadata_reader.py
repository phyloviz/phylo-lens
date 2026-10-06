from __future__ import annotations

import json
from dataclasses import replace

from phylo_lens_server.database.sql import LayoutSQL
from phylo_lens_server.domain.summaries import (
    MetadataMap,
    aggregate_cluster_metadata_by_node_ids,
)
from phylo_lens_server.domain.views import (
    AncillaryField,
    ViewportNode,
)
from phylo_lens_server.repository.layout.ancillary_distribution import (
    load_cluster_distributions,
)
from phylo_lens_server.repository.layout.isolate_membership import load_isolates


def load_metadata_rows(
    connection: LayoutSQL,
    *,
    table: str,
    key_column: str,
    dataset_id: str,
    layout_version: str,
    keys: set[str],
) -> dict[str, MetadataMap]:
    if not keys:
        return {}
    predicate, parameters = connection.membership(key_column, keys)
    rows = connection.execute(
        f"""
        select {key_column} as row_key, metadata_json
        from {table}
        where dataset_id = ?
          and layout_version = ?
          and {predicate}
        """,
        (dataset_id, layout_version, *parameters),
    ).fetchall()
    return {row["row_key"]: json.loads(row["metadata_json"]) for row in rows}


def load_metadata_schema(
    connection: LayoutSQL,
    *,
    dataset_id: str,
    layout_version: str,
) -> tuple[AncillaryField, ...]:
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
        AncillaryField(key=row["field_key"], type=row["field_type"]) for row in rows
    )


def attach_node_metadata(
    connection: LayoutSQL,
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
    isolates = load_isolates(
        connection,
        dataset_id=dataset_id,
        layout_version=layout_version,
        node_ids={node.node_id for node in nodes if node.member_count == 1},
    )
    distributions = load_cluster_distributions(
        connection,
        dataset_id=dataset_id,
        layout_version=layout_version,
        cluster_ids=cluster_ids,
        placeholder="?",
    )
    enriched: list[ViewportNode] = []
    for node in nodes:
        metadata = (
            cluster_metadata.get(node.cluster_id)
            if node.is_representative
            else node_metadata.get(node.node_id)
        )
        enriched.append(
            replace(
                node,
                metadata=metadata,
                isolates=isolates.get(node.node_id, ()),
                ancillary_distribution=distributions.get(node.cluster_id, ())
                if node.is_representative
                else (),
            )
        )
    return tuple(enriched)


def load_cluster_metadata(
    connection: LayoutSQL,
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
    connection: LayoutSQL,
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
    connection: LayoutSQL,
    *,
    dataset_id: str,
    layout_version: str,
    cluster_ids: set[str],
) -> dict[str, tuple[str, ...]]:
    if not cluster_ids:
        return {}
    predicate, parameters = connection.membership("cluster_id", cluster_ids)
    rows = connection.execute(
        f"""
        select cluster_id, node_id
        from cluster_members
        where dataset_id = ?
          and layout_version = ?
          and {predicate}
        order by cluster_id, node_id
        """,
        (dataset_id, layout_version, *parameters),
    ).fetchall()
    members: dict[str, list[str]] = {}
    for row in rows:
        members.setdefault(row["cluster_id"], []).append(row["node_id"])
    return {cluster_id: tuple(node_ids) for cluster_id, node_ids in members.items()}


def cache_cluster_metadata(
    connection: LayoutSQL,
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
