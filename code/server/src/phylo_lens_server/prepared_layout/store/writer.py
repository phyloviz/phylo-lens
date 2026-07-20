from __future__ import annotations

from collections.abc import Callable, Iterable, Iterator
from contextlib import nullcontext
import json
import sqlite3
from typing import Any, ContextManager

from phylo_lens_server.core.metadata_keys import is_internal_metadata_key
from phylo_lens_server.prepared_layout.models import (
    PreparedLayoutArtifacts,
    PreparedEdge,
    ClusterLayout,
    NodeLayoutPosition,
)
from phylo_lens_server.prepared_layout.store.metadata_reader import (
    aggregate_cluster_metadata_by_node_ids,
)
from phylo_lens_server.prepared_layout.store.schema import connect, table_exists

SQLRow = tuple[Any, ...]
StageFactory = Callable[[str], ContextManager[None]]

BULK_INSERT_BATCH_SIZE = 5_000
PRECOMPUTED_CLUSTER_METADATA_TIERS = 3


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


def save_artifacts(
    database_path,
    artifacts: PreparedLayoutArtifacts,
    *,
    status: str = "refining",
    stage_factory: StageFactory | None = None,
) -> None:
    with connect(database_path) as connection:
        with _stage(stage_factory, "persist_artifacts.datasets"):
            connection.execute(
                """
                insert into datasets(dataset_id, layout_version, status)
                values (?, ?, ?)
                on conflict(dataset_id, layout_version) do update set
                    status = excluded.status
                """,
                (artifacts.dataset.dataset_id, artifacts.layout_version, status),
            )
        with _stage(stage_factory, "persist_artifacts.prepared_clusters"):
            execute_many_chunked(
                connection,
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
                prepared_cluster_rows(artifacts),
            )
        with _stage(stage_factory, "persist_artifacts.cluster_members"):
            execute_many_chunked(
                connection,
                """
                insert into cluster_members(
                    dataset_id, layout_version, cluster_id, node_id
                )
                values (?, ?, ?, ?)
                on conflict do nothing
                """,
                cluster_member_rows(artifacts),
            )
        with _stage(stage_factory, "persist_artifacts.graph_edges"):
            execute_many_chunked(
                connection,
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
                graph_edge_rows(artifacts),
            )
        _persist_metadata(connection, artifacts, stage_factory=stage_factory)


def _stage(
    stage_factory: StageFactory | None,
    name: str,
) -> ContextManager[None]:
    if stage_factory is None:
        return nullcontext()
    return stage_factory(name)


def execute_many_chunked(
    connection: sqlite3.Connection,
    sql: str,
    rows: Iterable[SQLRow],
    *,
    batch_size: int = BULK_INSERT_BATCH_SIZE,
) -> int:
    total = 0
    batch: list[SQLRow] = []
    for row in rows:
        batch.append(row)
        if len(batch) >= batch_size:
            connection.executemany(sql, batch)
            total += len(batch)
            batch.clear()
    if batch:
        connection.executemany(sql, batch)
        total += len(batch)
    return total


def prepared_cluster_rows(artifacts: PreparedLayoutArtifacts) -> Iterator[SQLRow]:
    dataset_id = artifacts.dataset.dataset_id
    layout_version = artifacts.layout_version
    for cluster in artifacts.clusters:
        yield (
            dataset_id,
            layout_version,
            cluster.cluster_id,
            cluster.threshold,
            cluster.representative_node_id,
            cluster.member_count,
            "pending",
        )


def cluster_member_rows(artifacts: PreparedLayoutArtifacts) -> Iterator[SQLRow]:
    dataset_id = artifacts.dataset.dataset_id
    layout_version = artifacts.layout_version
    for cluster in artifacts.clusters:
        for node_id in cluster.member_node_ids:
            yield (dataset_id, layout_version, cluster.cluster_id, node_id)


def graph_edge_rows(artifacts: PreparedLayoutArtifacts) -> Iterator[SQLRow]:
    dataset_id = artifacts.dataset.dataset_id
    layout_version = artifacts.layout_version
    for edge in artifacts.dataset.edges:
        yield (
            dataset_id,
            layout_version,
            edge.id,
            edge.source,
            edge.target,
            edge.distance,
        )


def _persist_metadata(
    connection: sqlite3.Connection,
    artifacts: PreparedLayoutArtifacts,
    *,
    stage_factory: StageFactory | None = None,
) -> None:
    dataset_id = artifacts.dataset.dataset_id
    layout_version = artifacts.layout_version
    public_fields = tuple(
        (field.key, str(field.type))
        for field in artifacts.dataset.metadata_schema
        if not is_internal_metadata_key(field.key)
    )
    public_keys = {key for key, _ in public_fields}

    with _stage(stage_factory, "persist_artifacts.metadata_schema"):
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
    with _stage(stage_factory, "persist_artifacts.public_metadata"):
        public_metadata_by_node = public_metadata_by_node_map(
            metadata_by_node,
            public_keys,
        )
    with _stage(stage_factory, "persist_artifacts.metadata_json"):
        public_metadata_json_by_node = {
            node_id: json.dumps(metadata)
            for node_id, metadata in public_metadata_by_node.items()
        }
    with _stage(stage_factory, "persist_artifacts.node_metadata"):
        execute_many_chunked(
            connection,
            """
            insert into node_metadata(
                dataset_id, layout_version, node_id, metadata_json
            )
            values (?, ?, ?, ?)
            on conflict(dataset_id, layout_version, node_id) do update set
                metadata_json = excluded.metadata_json
            """,
            node_metadata_rows(
                dataset_id,
                layout_version,
                public_metadata_json_by_node,
            ),
        )
    with _stage(stage_factory, "persist_artifacts.cluster_metadata"):
        execute_many_chunked(
            connection,
            """
            insert into cluster_metadata(
                dataset_id, layout_version, cluster_id, metadata_json
            )
            values (?, ?, ?, ?)
            on conflict(dataset_id, layout_version, cluster_id) do update set
                metadata_json = excluded.metadata_json
            """,
            cluster_metadata_rows(
                artifacts,
                public_metadata_by_node,
                public_metadata_json_by_node,
                public_fields,
            ),
        )


def public_metadata_by_node_map(
    metadata_by_node: dict[str, dict[str, str | float | bool | None]],
    public_keys: set[str],
) -> dict[str, dict[str, str | float | bool | None]]:
    return {
        node_id: {key: value for key, value in metadata.items() if key in public_keys}
        for node_id, metadata in metadata_by_node.items()
    }


def node_metadata_rows(
    dataset_id: str,
    layout_version: str,
    public_metadata_json_by_node: dict[str, str],
) -> Iterator[SQLRow]:
    for node_id, metadata_json in public_metadata_json_by_node.items():
        yield (dataset_id, layout_version, node_id, metadata_json)


def cluster_metadata_rows(
    artifacts: PreparedLayoutArtifacts,
    public_metadata_by_node: dict[str, dict[str, str | float | bool | None]],
    public_metadata_json_by_node: dict[str, str],
    public_fields: tuple[tuple[str, str], ...],
) -> Iterator[SQLRow]:
    dataset_id = artifacts.dataset.dataset_id
    layout_version = artifacts.layout_version
    precomputed_thresholds = precomputed_cluster_metadata_thresholds(artifacts)
    for cluster in artifacts.clusters:
        if cluster.threshold not in precomputed_thresholds:
            continue
        if cluster.member_count == 1:
            metadata_json = public_metadata_json_by_node.get(
                cluster.member_node_ids[0],
                "{}",
            )
        else:
            metadata_json = json.dumps(
                aggregate_cluster_metadata_by_node_ids(
                    cluster.member_node_ids,
                    public_metadata_by_node,
                    public_fields,
                )
            )
        yield (dataset_id, layout_version, cluster.cluster_id, metadata_json)


def precomputed_cluster_metadata_thresholds(
    artifacts: PreparedLayoutArtifacts,
) -> set[float]:
    thresholds = sorted(
        {
            cluster.threshold
            for cluster in artifacts.clusters
            if cluster.threshold is not None
        },
        reverse=True,
    )
    return set(thresholds[:PRECOMPUTED_CLUSTER_METADATA_TIERS])


def save_layouts(
    database_path,
    cluster_layouts: tuple[ClusterLayout, ...],
    node_positions: tuple[NodeLayoutPosition, ...],
    *,
    stage_factory: StageFactory | None = None,
) -> None:
    with connect(database_path) as connection:
        with _stage(stage_factory, "persist_layouts.prepared_clusters"):
            execute_many_chunked(
                connection,
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
                cluster_layout_rows(cluster_layouts),
            )
        if node_positions:
            first_position = node_positions[0]
            with _stage(stage_factory, "persist_layouts.node_positions.clear_existing"):
                connection.execute(
                    """
                    delete from node_positions
                    where dataset_id = ? and layout_version = ?
                    """,
                    (first_position.dataset_id, first_position.layout_version),
                )
        with _stage(stage_factory, "persist_layouts.node_positions.rows"):
            execute_many_chunked(
                connection,
                """
                insert into node_positions(
                    dataset_id, layout_version, cluster_id, node_id,
                    x, y, status
                )
                values (?, ?, ?, ?, ?, ?, ?)
                """,
                node_position_rows(cluster_layouts, node_positions),
            )
        if cluster_layouts:
            first = cluster_layouts[0]
            with _stage(stage_factory, "persist_layouts.dataset_status"):
                connection.execute(
                    """
                    update datasets set status = ?, updated_at = current_timestamp
                    where dataset_id = ? and layout_version = ?
                    """,
                    (first.status, first.dataset_id, first.layout_version),
                )


def cluster_layout_rows(cluster_layouts: tuple[ClusterLayout, ...]) -> Iterator[SQLRow]:
    for layout in cluster_layouts:
        yield (
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


def node_position_rows(
    cluster_layouts: tuple[ClusterLayout, ...],
    node_positions: tuple[NodeLayoutPosition, ...],
) -> Iterator[SQLRow]:
    singleton_cluster_ids = {
        layout.cluster_id for layout in cluster_layouts if layout.member_count == 1
    }
    fallback_by_node_id: dict[str, NodeLayoutPosition] = {}
    yielded_node_ids: set[str] = set()
    for position in node_positions:
        if position.node_id in yielded_node_ids:
            continue
        if position.cluster_id in singleton_cluster_ids:
            yielded_node_ids.add(position.node_id)
            yield node_position_row(position)
            continue
        fallback_by_node_id.setdefault(position.node_id, position)

    for node_id, position in fallback_by_node_id.items():
        if node_id not in yielded_node_ids:
            yield node_position_row(position)


def node_position_row(position: NodeLayoutPosition) -> SQLRow:
    return (
        position.dataset_id,
        position.layout_version,
        position.cluster_id,
        position.node_id,
        position.x,
        position.y,
        position.status,
    )


def save_prepared_edges(
    database_path,
    prepared_edges: tuple[PreparedEdge, ...],
    *,
    stage_factory: StageFactory | None = None,
) -> None:
    if not prepared_edges:
        return
    with connect(database_path) as connection:
        first = prepared_edges[0]
        with _stage(stage_factory, "persist_prepared_edges.clear_existing"):
            connection.execute(
                """
                delete from prepared_edges
                where dataset_id = ? and layout_version = ?
                """,
                (first.dataset_id, first.layout_version),
            )
        with _stage(stage_factory, "persist_prepared_edges.rows"):
            execute_many_chunked(
                connection,
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
                prepared_edge_rows(prepared_edges),
            )


def prepared_edge_rows(prepared_edges: tuple[PreparedEdge, ...]) -> Iterator[SQLRow]:
    for edge in prepared_edges:
        yield (
            edge.dataset_id,
            edge.layout_version,
            edge.lod_level,
            edge.edge_id,
            edge.source,
            edge.target,
            edge.distance,
        )
