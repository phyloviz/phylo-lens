from __future__ import annotations

import json
import sqlite3

from phylo_lens_server.core.metadata_keys import is_internal_metadata_key
from phylo_lens_server.prepared_layout.models import (
    PreparedLayoutArtifacts,
    PreparedEdge,
    ClusterLayout,
    NodeLayoutPosition,
)
from phylo_lens_server.prepared_layout.store.metadata_reader import (
    aggregate_cluster_metadata,
)
from phylo_lens_server.prepared_layout.store.schema import connect, table_exists


def clear_dataset(
    database_path,
    dataset_id: str,
    threshold_cache: dict[tuple[str, str], tuple[float, ...]],
) -> None:
    threshold_cache_keys = [key for key in threshold_cache if key[0] == dataset_id]
    for key in threshold_cache_keys:
        threshold_cache.pop(key, None)
    with connect(database_path) as connection:
        for table in (
            "node_positions",
            "prepared_edges",
            "graph_edges",
            "cluster_members",
            "prepared_clusters",
            "datasets",
            "cluster_edges",
            "node_metadata",
            "cluster_metadata",
            "metadata_schema",
        ):
            if not table_exists(connection, table):
                continue
            connection.execute(
                f"delete from {table} where dataset_id = ?",
                (dataset_id,),
            )


def save_artifacts(database_path, artifacts: PreparedLayoutArtifacts) -> None:
    with connect(database_path) as connection:
        connection.execute(
            """
            insert into datasets(dataset_id, layout_version, status)
            values (?, ?, ?)
            on conflict(dataset_id, layout_version) do update set
                status = excluded.status
            """,
            (artifacts.dataset.dataset_id, artifacts.layout_version, "refining"),
        )
        connection.executemany(
            """
            insert into prepared_clusters(
                dataset_id, layout_version, cluster_id, threshold,
                representative_node_id, member_count, status
            )
            values (?, ?, ?, ?, ?, ?, ?)
            on conflict(dataset_id, layout_version, cluster_id) do update set
                threshold = excluded.threshold,
                representative_node_id = excluded.representative_node_id,
                member_count = excluded.member_count,
                status = excluded.status
            """,
            [
                (
                    artifacts.dataset.dataset_id,
                    artifacts.layout_version,
                    cluster.cluster_id,
                    cluster.threshold,
                    cluster.representative_node_id,
                    cluster.member_count,
                    "pending",
                )
                for cluster in artifacts.clusters
            ],
        )
        connection.executemany(
            """
            insert into cluster_members(
                dataset_id, layout_version, cluster_id, node_id
            )
            values (?, ?, ?, ?)
            on conflict do nothing
            """,
            [
                (
                    artifacts.dataset.dataset_id,
                    artifacts.layout_version,
                    cluster.cluster_id,
                    node_id,
                )
                for cluster in artifacts.clusters
                for node_id in cluster.member_node_ids
            ],
        )
        connection.executemany(
            """
            insert into graph_edges(
                dataset_id, layout_version, edge_id,
                source_node_id, target_node_id, distance
            )
            values (?, ?, ?, ?, ?, ?)
            on conflict(dataset_id, layout_version, edge_id) do update set
                source_node_id = excluded.source_node_id,
                target_node_id = excluded.target_node_id,
                distance = excluded.distance
            """,
            [
                (
                    artifacts.dataset.dataset_id,
                    artifacts.layout_version,
                    edge.id,
                    edge.source,
                    edge.target,
                    edge.distance,
                )
                for edge in artifacts.dataset.edges
            ],
        )
        _persist_metadata(connection, artifacts)


def _persist_metadata(
    connection: sqlite3.Connection,
    artifacts: PreparedLayoutArtifacts,
) -> None:
    dataset_id = artifacts.dataset.dataset_id
    layout_version = artifacts.layout_version
    public_fields = tuple(
        (field.key, str(field.type))
        for field in artifacts.dataset.metadata_schema
        if not is_internal_metadata_key(field.key)
    )
    public_keys = {key for key, _ in public_fields}

    connection.executemany(
        """
        insert into metadata_schema(
            dataset_id, layout_version, field_key, field_type
        )
        values (?, ?, ?, ?)
        on conflict(dataset_id, layout_version, field_key) do update set
            field_type = excluded.field_type
        """,
        [
            (dataset_id, layout_version, key, field_type)
            for key, field_type in public_fields
        ],
    )

    metadata_by_node = artifacts.dataset.metadata_by_node_id
    public_metadata_by_node = {
        node_id: {key: value for key, value in metadata.items() if key in public_keys}
        for node_id, metadata in metadata_by_node.items()
    }
    connection.executemany(
        """
        insert into node_metadata(
            dataset_id, layout_version, node_id, metadata_json
        )
        values (?, ?, ?, ?)
        on conflict(dataset_id, layout_version, node_id) do update set
            metadata_json = excluded.metadata_json
        """,
        [
            (dataset_id, layout_version, node_id, json.dumps(metadata))
            for node_id, metadata in public_metadata_by_node.items()
        ],
    )

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
            (
                dataset_id,
                layout_version,
                cluster.cluster_id,
                json.dumps(
                    aggregate_cluster_metadata(
                        [
                            public_metadata_by_node.get(node_id, {})
                            for node_id in cluster.member_node_ids
                        ],
                        public_fields,
                    )
                ),
            )
            for cluster in artifacts.clusters
        ],
    )


def save_layouts(
    database_path,
    cluster_layouts: tuple[ClusterLayout, ...],
    node_positions: tuple[NodeLayoutPosition, ...],
) -> None:
    with connect(database_path) as connection:
        connection.executemany(
            """
            insert into prepared_clusters(
                dataset_id, layout_version, cluster_id, representative_node_id,
                member_count, x, y, radius, min_x, max_x, min_y, max_y, status
            )
            values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            on conflict(dataset_id, layout_version, cluster_id) do update set
                representative_node_id = excluded.representative_node_id,
                member_count = excluded.member_count,
                x = excluded.x,
                y = excluded.y,
                radius = excluded.radius,
                min_x = excluded.min_x,
                max_x = excluded.max_x,
                min_y = excluded.min_y,
                max_y = excluded.max_y,
                status = excluded.status
            """,
            [
                (
                    layout.dataset_id,
                    layout.layout_version,
                    layout.cluster_id,
                    layout.representative_node_id,
                    layout.member_count,
                    layout.x,
                    layout.y,
                    layout.radius,
                    layout.bounds.min_x,
                    layout.bounds.max_x,
                    layout.bounds.min_y,
                    layout.bounds.max_y,
                    layout.status,
                )
                for layout in cluster_layouts
            ],
        )
        connection.executemany(
            """
            insert into node_positions(
                dataset_id, layout_version, cluster_id, node_id,
                x, y, status
            )
            values (?, ?, ?, ?, ?, ?, ?)
            on conflict(dataset_id, layout_version, cluster_id, node_id)
            do update set
                x = excluded.x,
                y = excluded.y,
                status = excluded.status
            """,
            [
                (
                    position.dataset_id,
                    position.layout_version,
                    position.cluster_id,
                    position.node_id,
                    position.x,
                    position.y,
                    position.status,
                )
                for position in node_positions
            ],
        )
        if cluster_layouts:
            first = cluster_layouts[0]
            connection.execute(
                """
                update datasets set status = ?, updated_at = current_timestamp
                where dataset_id = ? and layout_version = ?
                """,
                (first.status, first.dataset_id, first.layout_version),
            )


def save_prepared_edges(
    database_path,
    prepared_edges: tuple[PreparedEdge, ...],
) -> None:
    if not prepared_edges:
        return
    with connect(database_path) as connection:
        first = prepared_edges[0]
        connection.execute(
            """
            delete from prepared_edges
            where dataset_id = ? and layout_version = ?
            """,
            (first.dataset_id, first.layout_version),
        )
        connection.executemany(
            """
            insert into prepared_edges(
                dataset_id, layout_version, lod_level, edge_id,
                source_node_id, target_node_id, distance
            )
            values (?, ?, ?, ?, ?, ?, ?)
            on conflict(dataset_id, layout_version, lod_level, edge_id)
            do update set
                source_node_id = excluded.source_node_id,
                target_node_id = excluded.target_node_id,
                distance = excluded.distance
            """,
            [
                (
                    edge.dataset_id,
                    edge.layout_version,
                    edge.lod_level,
                    edge.edge_id,
                    edge.source,
                    edge.target,
                    edge.distance,
                )
                for edge in prepared_edges
            ],
        )
