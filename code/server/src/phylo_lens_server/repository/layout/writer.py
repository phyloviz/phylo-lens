from __future__ import annotations

import json
from collections.abc import Callable, Iterable, Iterator
from contextlib import AbstractContextManager, nullcontext

from phylo_lens_server.database.sql import LayoutSQL
from phylo_lens_server.database.sqlite import table_exists
from phylo_lens_server.domain.legacy_metadata import (
    encode_dataset_annotations,
    is_summary_key,
)
from phylo_lens_server.domain.preparation import (
    ClusterLayout,
    NodeLayoutPosition,
    PreparedLayoutArtifacts,
    QuotientEdge,
)
from phylo_lens_server.domain.summaries import aggregate_cluster_metadata_by_node_ids
from phylo_lens_server.domain.views import LayoutStatus

SQLRow = tuple[object, ...]
StageFactory = Callable[[str], AbstractContextManager[None]]

BULK_INSERT_BATCH_SIZE = 5_000
PRECOMPUTED_CLUSTER_METADATA_TIERS = 3


def save_artifacts(
    connection: LayoutSQL,
    artifacts: PreparedLayoutArtifacts,
    *,
    status: LayoutStatus = "refining",
    stage_factory: StageFactory | None = None,
) -> None:
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
                    dataset_id, layout_version, cluster_id, lod_level,
                    representative_node_id, member_count, status
                )
                values (?, ?, ?, ?, ?, ?, ?)
                on conflict(dataset_id, layout_version, cluster_id) do update set
                    lod_level = excluded.lod_level,
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
    execute_many_chunked(
        connection,
        """insert into profile_isolates(dataset_id, layout_version, node_id, isolate_id, metadata_json)
            values (?, ?, ?, ?, ?)
            on conflict(dataset_id, layout_version, isolate_id) do update set
                node_id = excluded.node_id, metadata_json = excluded.metadata_json""",
        (
            (
                artifacts.dataset.dataset_id,
                artifacts.layout_version,
                node_id,
                isolate.id,
                json.dumps(dict(isolate.ancillary_data)),
            )
            for node_id, isolates in artifacts.dataset.isolates_by_node_id.items()
            for isolate in isolates
        ),
    )
    _persist_annotations(
        connection,
        artifacts,
        stage_factory=stage_factory,
    )


def _stage(
    stage_factory: StageFactory | None,
    name: str,
) -> AbstractContextManager[None]:
    if stage_factory is None:
        return nullcontext()
    return stage_factory(name)


def execute_many_chunked(
    connection: LayoutSQL,
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
            cluster.lod_level,
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


def _persist_annotations(
    connection: LayoutSQL,
    artifacts: PreparedLayoutArtifacts,
    *,
    stage_factory: StageFactory | None = None,
) -> None:
    dataset_id = artifacts.dataset.dataset_id
    layout_version = artifacts.layout_version
    public_fields = tuple(
        (field.key, str(field.type)) for field in artifacts.dataset.ancillary_schema
    )
    public_keys = {key for key, _ in public_fields}

    with _stage(stage_factory, "persist_artifacts.metadata_schema"):
        execute_many_chunked(
            connection,
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

    metadata_by_node = encode_dataset_annotations(artifacts.dataset)
    with _stage(stage_factory, "persist_artifacts.render_metadata"):
        render_metadata_by_node = render_metadata_by_node_map(
            metadata_by_node,
            public_keys,
        )
    with _stage(stage_factory, "persist_artifacts.metadata_json"):
        render_metadata_json_by_node = {
            node_id: json.dumps(metadata)
            for node_id, metadata in render_metadata_by_node.items()
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
                render_metadata_json_by_node,
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
                render_metadata_by_node,
                render_metadata_json_by_node,
                public_fields,
            ),
        )


def render_metadata_by_node_map(
    metadata_by_node: dict[str, dict[str, str | float | bool | None]],
    public_keys: set[str],
) -> dict[str, dict[str, str | float | bool | None]]:
    return {
        node_id: {
            key: value
            for key, value in metadata.items()
            if key in public_keys or is_summary_key(key)
        }
        for node_id, metadata in metadata_by_node.items()
    }


def node_metadata_rows(
    dataset_id: str,
    layout_version: str,
    render_metadata_json_by_node: dict[str, str],
) -> Iterator[SQLRow]:
    for node_id, metadata_json in render_metadata_json_by_node.items():
        yield (dataset_id, layout_version, node_id, metadata_json)


def cluster_metadata_rows(
    artifacts: PreparedLayoutArtifacts,
    render_metadata_by_node: dict[str, dict[str, str | float | bool | None]],
    render_metadata_json_by_node: dict[str, str],
    public_fields: tuple[tuple[str, str], ...],
) -> Iterator[SQLRow]:
    dataset_id = artifacts.dataset.dataset_id
    layout_version = artifacts.layout_version
    precomputed_levels = set(range(PRECOMPUTED_CLUSTER_METADATA_TIERS))
    for cluster in artifacts.clusters:
        if cluster.lod_level not in precomputed_levels:
            continue
        if cluster.member_count == 1:
            metadata_json = render_metadata_json_by_node.get(
                cluster.member_node_ids[0],
                "{}",
            )
        else:
            metadata_json = json.dumps(
                aggregate_cluster_metadata_by_node_ids(
                    cluster.member_node_ids,
                    render_metadata_by_node,
                    public_fields,
                )
            )
        yield (dataset_id, layout_version, cluster.cluster_id, metadata_json)


def save_layouts(
    connection: LayoutSQL,
    cluster_layouts: tuple[ClusterLayout, ...],
    node_positions: tuple[NodeLayoutPosition, ...],
    *,
    stage_factory: StageFactory | None = None,
) -> None:
    with _stage(stage_factory, "persist_layouts.prepared_clusters"):
        execute_many_chunked(
            connection,
            """
                update prepared_clusters set
                    representative_node_id = ?,
                    member_count = ?,
                    x = ?,
                    y = ?,
                    radius = ?,
                    min_x = ?,
                    max_x = ?,
                    min_y = ?,
                    max_y = ?,
                    status = ?
                where dataset_id = ? and layout_version = ? and cluster_id = ?
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


def cluster_layout_rows(cluster_layouts: tuple[ClusterLayout, ...]) -> Iterator[SQLRow]:
    for layout in cluster_layouts:
        yield (
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
            layout.dataset_id,
            layout.layout_version,
            layout.cluster_id,
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
    connection: LayoutSQL,
    prepared_edges: tuple[QuotientEdge, ...],
    *,
    stage_factory: StageFactory | None = None,
) -> None:
    if not prepared_edges:
        return
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


def prepared_edge_rows(prepared_edges: tuple[QuotientEdge, ...]) -> Iterator[SQLRow]:
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


LAYOUT_TABLES = (
    "node_positions",
    "prepared_edges",
    "graph_edges",
    "cluster_members",
    "prepared_clusters",
    "datasets",
    "node_metadata",
    "profile_isolates",
    "cluster_metadata",
    "metadata_schema",
)


def clear_dataset(
    connection: LayoutSQL, dataset_id: str, layout_version: str | None = None
) -> None:
    for table in LAYOUT_TABLES:
        if connection.backend == "sqlite" and not table_exists(
            connection.connection, table
        ):
            continue
        suffix = " and layout_version = ?" if layout_version is not None else ""
        parameters = (
            (dataset_id, layout_version)
            if layout_version is not None
            else (dataset_id,)
        )
        connection.execute(
            f"delete from {table} where dataset_id = ?{suffix}", parameters
        )


def publish_layout_version(
    connection: LayoutSQL, *, dataset_id: str, layout_version: str, status: LayoutStatus
) -> None:
    # PostgreSQL's existing trigger touches updated_at; SQLite uses this expression.
    touch = (
        ", updated_at = strftime('%Y-%m-%d %H:%M:%f', 'now')"
        if connection.backend == "sqlite"
        else ""
    )
    connection.execute(
        f"update datasets set status = ?{touch} where dataset_id = ? and layout_version = ?",
        (status, dataset_id, layout_version),
    )
