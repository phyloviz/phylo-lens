from __future__ import annotations

from collections.abc import Iterable
from dataclasses import replace
import json
from typing import Any

from phylo_lens_server.domain.metadata_keys import is_internal_metadata_key
from phylo_lens_server.repository.jobs.postgres import import_psycopg
from phylo_lens_server.pipeline.models import (
    ClusterLayout,
    LayoutBounds,
    LayoutStatus,
    MetadataSchemaField,
    NodeLayoutPosition,
    PreparedEdge,
    PreparedLayoutArtifacts,
    RegionReadResult,
    SearchMatch,
    SearchReadResult,
    ViewportEdge,
    ViewportNode,
    ViewportReadResult,
)
from phylo_lens_server.repository.layout import writer
from phylo_lens_server.repository.layout.metadata_reader import (
    aggregate_cluster_metadata,
    aggregate_cluster_metadata_by_node_ids,
    aggregate_layout_status,
)
from phylo_lens_server.repository.layout.node_search import (
    SEARCH_SCORE_ID_EXACT,
    SEARCH_SCORE_ID_PREFIX,
    SEARCH_SCORE_ID_SUBSTRING,
    SEARCH_SCORE_METADATA_VALUE,
    _escape_like,
    _first_matching_value,
    _is_union_node_id,
)
from phylo_lens_server.repository.layout.viewport_reader import has_bounds

SQLRow = tuple[Any, ...]
BULK_INSERT_BATCH_SIZE = writer.BULK_INSERT_BATCH_SIZE


class PostgresPreparedLayoutStore:
    """Postgres store for materialized layout artifacts and viewport reads."""

    def __init__(self, dsn: str) -> None:
        self._dsn = dsn
        self._threshold_cache: dict[tuple[str, str], tuple[float, ...]] = {}
        self.path = dsn

    def clear_dataset(self, dataset_id: str) -> None:
        keys = [key for key in self._threshold_cache if key[0] == dataset_id]
        for key in keys:
            self._threshold_cache.pop(key, None)
        with self._connect() as connection:
            with connection.transaction():
                for table in layout_tables():
                    connection.execute(
                        f"delete from {table} where dataset_id = %s", (dataset_id,)
                    )

    def clear_layout_version(self, dataset_id: str, layout_version: str) -> None:
        self._threshold_cache.pop((dataset_id, layout_version), None)
        with self._connect() as connection:
            with connection.transaction():
                for table in layout_tables():
                    connection.execute(
                        f"delete from {table} where dataset_id = %s and layout_version = %s",
                        (dataset_id, layout_version),
                    )

    def save_artifacts(
        self,
        artifacts: PreparedLayoutArtifacts,
        *,
        status: str = "refining",
        stage_factory=None,
    ) -> None:
        with self._connect() as connection:
            with connection.transaction():
                with writer._stage(stage_factory, "persist_artifacts.datasets"):
                    connection.execute(
                        """
                        insert into datasets(dataset_id, layout_version, status)
                        values (%s, %s, %s)
                        on conflict(dataset_id, layout_version) do update set
                            status = excluded.status
                        """,
                        (
                            artifacts.dataset.dataset_id,
                            artifacts.layout_version,
                            status,
                        ),
                    )
                with writer._stage(
                    stage_factory, "persist_artifacts.prepared_clusters"
                ):
                    execute_many_chunked(
                        connection,
                        """
                        insert into prepared_clusters(
                            dataset_id, layout_version, cluster_id, threshold,
                            representative_node_id, member_count, status
                        )
                        values (%s, %s, %s, %s, %s, %s, %s)
                        on conflict(dataset_id, layout_version, cluster_id) do update set
                            threshold = excluded.threshold,
                            representative_node_id = excluded.representative_node_id,
                            member_count = excluded.member_count,
                            status = excluded.status
                        """,
                        writer.prepared_cluster_rows(artifacts),
                    )
                with writer._stage(stage_factory, "persist_artifacts.cluster_members"):
                    execute_many_chunked(
                        connection,
                        """
                        insert into cluster_members(
                            dataset_id, layout_version, cluster_id, node_id
                        )
                        values (%s, %s, %s, %s)
                        on conflict do nothing
                        """,
                        writer.cluster_member_rows(artifacts),
                    )
                with writer._stage(stage_factory, "persist_artifacts.graph_edges"):
                    execute_many_chunked(
                        connection,
                        """
                        insert into graph_edges(
                            dataset_id, layout_version, edge_id,
                            source_node_id, target_node_id, distance
                        )
                        values (%s, %s, %s, %s, %s, %s)
                        on conflict(dataset_id, layout_version, edge_id) do update set
                            source_node_id = excluded.source_node_id,
                            target_node_id = excluded.target_node_id,
                            distance = excluded.distance
                        """,
                        writer.graph_edge_rows(artifacts),
                    )
                self._persist_metadata(
                    connection, artifacts, stage_factory=stage_factory
                )

    def save_layouts(
        self,
        cluster_layouts: tuple[ClusterLayout, ...],
        node_positions: tuple[NodeLayoutPosition, ...],
        *,
        stage_factory=None,
    ) -> None:
        with self._connect() as connection:
            with connection.transaction():
                with writer._stage(stage_factory, "persist_layouts.prepared_clusters"):
                    execute_many_chunked(
                        connection,
                        """
                        insert into prepared_clusters(
                            dataset_id, layout_version, cluster_id, representative_node_id,
                            member_count, x, y, radius, min_x, max_x, min_y, max_y, status
                        )
                        values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
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
                        writer.cluster_layout_rows(cluster_layouts),
                    )
                if node_positions:
                    first = node_positions[0]
                    with writer._stage(
                        stage_factory, "persist_layouts.node_positions.clear_existing"
                    ):
                        connection.execute(
                            """
                            delete from node_positions
                            where dataset_id = %s and layout_version = %s
                            """,
                            (first.dataset_id, first.layout_version),
                        )
                with writer._stage(
                    stage_factory, "persist_layouts.node_positions.rows"
                ):
                    execute_many_chunked(
                        connection,
                        """
                        insert into node_positions(
                            dataset_id, layout_version, cluster_id, node_id,
                            x, y, status
                        )
                        values (%s, %s, %s, %s, %s, %s, %s)
                        """,
                        writer.node_position_rows(cluster_layouts, node_positions),
                    )

    def save_prepared_edges(
        self,
        prepared_edges: tuple[PreparedEdge, ...],
        *,
        stage_factory=None,
    ) -> None:
        if not prepared_edges:
            return
        with self._connect() as connection:
            with connection.transaction():
                first = prepared_edges[0]
                with writer._stage(
                    stage_factory, "persist_prepared_edges.clear_existing"
                ):
                    connection.execute(
                        """
                        delete from prepared_edges
                        where dataset_id = %s and layout_version = %s
                        """,
                        (first.dataset_id, first.layout_version),
                    )
                with writer._stage(stage_factory, "persist_prepared_edges.rows"):
                    execute_many_chunked(
                        connection,
                        """
                        insert into prepared_edges(
                            dataset_id, layout_version, lod_level, edge_id,
                            source_node_id, target_node_id, distance
                        )
                        values (%s, %s, %s, %s, %s, %s, %s)
                        on conflict(dataset_id, layout_version, lod_level, edge_id)
                        do update set
                            source_node_id = excluded.source_node_id,
                            target_node_id = excluded.target_node_id,
                            distance = excluded.distance
                        """,
                        writer.prepared_edge_rows(prepared_edges),
                    )

    def publish_layout_version(
        self,
        *,
        dataset_id: str,
        layout_version: str,
        status: LayoutStatus,
    ) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                update datasets
                set status = %s
                where dataset_id = %s and layout_version = %s
                """,
                (status, dataset_id, layout_version),
            )

    def latest_layout_version(self, dataset_id: str) -> str | None:
        with self._connect() as connection:
            row = connection.execute(
                """
                select layout_version
                from datasets
                where dataset_id = %s
                  and status in ('ready', 'degraded')
                order by updated_at desc, created_at desc
                limit 1
                """,
                (dataset_id,),
            ).fetchone()
        return None if row is None else row["layout_version"]

    def load_cluster_layouts(
        self, dataset_id: str, layout_version: str
    ) -> list[ClusterLayout]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                select cluster_id, representative_node_id, member_count,
                       x, y, radius, min_x, max_x, min_y, max_y, status
                from prepared_clusters
                where dataset_id = %s and layout_version = %s and x is not null
                order by cluster_id
                """,
                (dataset_id, layout_version),
            ).fetchall()
        return [
            ClusterLayout(
                dataset_id=dataset_id,
                layout_version=layout_version,
                cluster_id=row["cluster_id"],
                representative_node_id=row["representative_node_id"],
                member_count=row["member_count"],
                x=row["x"],
                y=row["y"],
                radius=row["radius"],
                bounds=LayoutBounds(
                    min_x=row["min_x"],
                    max_x=row["max_x"],
                    min_y=row["min_y"],
                    max_y=row["max_y"],
                ),
                status=row["status"],
            )
            for row in rows
        ]

    def load_node_positions(
        self, dataset_id: str, layout_version: str
    ) -> list[NodeLayoutPosition]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                select cluster_id, node_id, x, y, status
                from node_positions
                where dataset_id = %s and layout_version = %s
                order by cluster_id, node_id
                """,
                (dataset_id, layout_version),
            ).fetchall()
        return [
            NodeLayoutPosition(
                dataset_id=dataset_id,
                layout_version=layout_version,
                cluster_id=row["cluster_id"],
                node_id=row["node_id"],
                x=row["x"],
                y=row["y"],
                status=row["status"],
            )
            for row in rows
        ]

    def read_viewport(
        self,
        *,
        dataset_id: str,
        layout_version: str,
        xmin: float | None,
        xmax: float | None,
        ymin: float | None,
        ymax: float | None,
        max_nodes: int,
        lod_level: int | None = None,
        cluster_id: str | None = None,
        focus_node_id: str | None = None,
    ) -> ViewportReadResult:
        with self._connect() as connection:
            return read_viewport(
                connection,
                self._threshold_cache,
                dataset_id=dataset_id,
                layout_version=layout_version,
                xmin=xmin,
                xmax=xmax,
                ymin=ymin,
                ymax=ymax,
                max_nodes=max_nodes,
                lod_level=lod_level,
                cluster_id=cluster_id,
                focus_node_id=focus_node_id,
            )

    def read_region(
        self,
        *,
        dataset_id: str,
        layout_version: str,
        xmin: float,
        xmax: float,
        ymin: float,
        ymax: float,
        max_nodes: int,
    ) -> RegionReadResult:
        with self._connect() as connection:
            ready_nodes, total_node_count = read_ready_nodes(
                connection,
                dataset_id=dataset_id,
                layout_version=layout_version,
                xmin=xmin,
                xmax=xmax,
                ymin=ymin,
                ymax=ymax,
                max_nodes=max_nodes,
            )
            nodes = tuple(ready_nodes)
            node_ids = {node.node_id for node in nodes}
            edges = read_edges_for_nodes(
                connection,
                dataset_id=dataset_id,
                layout_version=layout_version,
                node_ids=node_ids,
            )
            nodes = attach_node_metadata(
                connection,
                dataset_id=dataset_id,
                layout_version=layout_version,
                nodes=nodes,
            )
            metadata_schema = load_metadata_schema(
                connection,
                dataset_id=dataset_id,
                layout_version=layout_version,
            )
        aggregated_metadata = aggregate_cluster_metadata(
            [node.metadata or {} for node in nodes],
            tuple((field.key, field.type) for field in metadata_schema),
        )
        layout_status = aggregate_layout_status({node.layout_status for node in nodes})
        return RegionReadResult(
            dataset_id=dataset_id,
            layout_version=layout_version,
            nodes=nodes,
            edges=tuple(edges),
            total_node_count=total_node_count,
            truncated=total_node_count > len(nodes),
            layout_status=layout_status,
            metadata_schema=metadata_schema,
            aggregated_metadata=aggregated_metadata,
        )

    def search_nodes(
        self,
        *,
        dataset_id: str,
        layout_version: str,
        query: str,
        limit: int,
    ) -> SearchReadResult:
        return search_nodes(
            self._connect(),
            dataset_id=dataset_id,
            layout_version=layout_version,
            query=query,
            limit=limit,
        )

    def _connect(self):
        psycopg = import_psycopg()
        return psycopg.connect(self._dsn, row_factory=psycopg.rows.dict_row)

    def _persist_metadata(
        self, connection, artifacts: PreparedLayoutArtifacts, *, stage_factory=None
    ) -> None:
        dataset_id = artifacts.dataset.dataset_id
        layout_version = artifacts.layout_version
        public_fields = tuple(
            (field.key, str(field.type))
            for field in artifacts.dataset.metadata_schema
            if not is_internal_metadata_key(field.key)
        )
        public_keys = {key for key, _ in public_fields}

        with writer._stage(stage_factory, "persist_artifacts.metadata_schema"):
            execute_many_chunked(
                connection,
                """
                insert into metadata_schema(
                    dataset_id, layout_version, field_key, field_type
                )
                values (%s, %s, %s, %s)
                on conflict(dataset_id, layout_version, field_key) do update set
                    field_type = excluded.field_type
                """,
                [
                    (dataset_id, layout_version, key, field_type)
                    for key, field_type in public_fields
                ],
            )

        render_metadata_by_node = writer.render_metadata_by_node_map(
            artifacts.dataset.metadata_by_node_id,
            public_keys,
        )
        render_metadata_json_by_node = {
            node_id: json.dumps(metadata)
            for node_id, metadata in render_metadata_by_node.items()
        }
        with writer._stage(stage_factory, "persist_artifacts.node_metadata"):
            execute_many_chunked(
                connection,
                """
                insert into node_metadata(
                    dataset_id, layout_version, node_id, metadata_json
                )
                values (%s, %s, %s, %s)
                on conflict(dataset_id, layout_version, node_id) do update set
                    metadata_json = excluded.metadata_json
                """,
                writer.node_metadata_rows(
                    dataset_id, layout_version, render_metadata_json_by_node
                ),
            )
        with writer._stage(stage_factory, "persist_artifacts.cluster_metadata"):
            execute_many_chunked(
                connection,
                """
                insert into cluster_metadata(
                    dataset_id, layout_version, cluster_id, metadata_json
                )
                values (%s, %s, %s, %s)
                on conflict(dataset_id, layout_version, cluster_id) do update set
                    metadata_json = excluded.metadata_json
                """,
                writer.cluster_metadata_rows(
                    artifacts,
                    render_metadata_by_node,
                    render_metadata_json_by_node,
                    public_fields,
                ),
            )


def layout_tables() -> tuple[str, ...]:
    return (
        "node_positions",
        "prepared_edges",
        "graph_edges",
        "cluster_members",
        "prepared_clusters",
        "datasets",
        "node_metadata",
        "cluster_metadata",
        "metadata_schema",
    )


def execute_many_chunked(
    connection,
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
            with connection.cursor() as cursor:
                cursor.executemany(sql, batch)
            total += len(batch)
            batch.clear()
    if batch:
        with connection.cursor() as cursor:
            cursor.executemany(sql, batch)
        total += len(batch)
    return total


def load_metadata_schema(
    connection, *, dataset_id: str, layout_version: str
) -> tuple[MetadataSchemaField, ...]:
    rows = connection.execute(
        """
        select field_key, field_type
        from metadata_schema
        where dataset_id = %s and layout_version = %s
        order by field_key
        """,
        (dataset_id, layout_version),
    ).fetchall()
    return tuple(
        MetadataSchemaField(key=row["field_key"], type=row["field_type"])
        for row in rows
    )


def load_metadata_rows(
    connection,
    *,
    table: str,
    key_column: str,
    dataset_id: str,
    layout_version: str,
    keys: set[str],
):
    if not keys:
        return {}
    rows = connection.execute(
        f"""
        select {key_column} as row_key, metadata_json
        from {table}
        where dataset_id = %s
          and layout_version = %s
          and {key_column} = any(%s)
        """,
        (dataset_id, layout_version, list(sorted(keys))),
    ).fetchall()
    return {row["row_key"]: json.loads(row["metadata_json"]) for row in rows}


def attach_node_metadata(
    connection, *, dataset_id: str, layout_version: str, nodes: tuple[ViewportNode, ...]
):
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
    return tuple(
        replace(
            node,
            metadata=cluster_metadata.get(node.cluster_id)
            if node.is_representative
            else node_metadata.get(node.node_id),
        )
        if (
            cluster_metadata.get(node.cluster_id)
            if node.is_representative
            else node_metadata.get(node.node_id)
        )
        else node
        for node in nodes
    )


def load_cluster_metadata(
    connection, *, dataset_id: str, layout_version: str, cluster_ids: set[str]
):
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
    missing = cluster_ids - set(cached)
    if not missing:
        return cached
    computed = compute_cluster_metadata(
        connection,
        dataset_id=dataset_id,
        layout_version=layout_version,
        cluster_ids=missing,
    )
    if computed:
        execute_many_chunked(
            connection,
            """
            insert into cluster_metadata(dataset_id, layout_version, cluster_id, metadata_json)
            values (%s, %s, %s, %s)
            on conflict(dataset_id, layout_version, cluster_id) do update set
                metadata_json = excluded.metadata_json
            """,
            (
                (dataset_id, layout_version, cluster_id, json.dumps(metadata))
                for cluster_id, metadata in computed.items()
            ),
        )
    return {**cached, **computed}


def compute_cluster_metadata(
    connection, *, dataset_id: str, layout_version: str, cluster_ids: set[str]
):
    schema = tuple(
        (field.key, field.type)
        for field in load_metadata_schema(
            connection, dataset_id=dataset_id, layout_version=layout_version
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
        for member_ids in members_by_cluster_id.values()
        for node_id in member_ids
    }
    metadata_by_node = load_metadata_rows(
        connection,
        table="node_metadata",
        key_column="node_id",
        dataset_id=dataset_id,
        layout_version=layout_version,
        keys=member_ids,
    )
    computed = {}
    for cluster_id, member_ids_for_cluster in members_by_cluster_id.items():
        if len(member_ids_for_cluster) == 1:
            metadata = metadata_by_node.get(member_ids_for_cluster[0], {})
        else:
            metadata = aggregate_cluster_metadata_by_node_ids(
                member_ids_for_cluster, metadata_by_node, schema
            )
        if metadata:
            computed[cluster_id] = metadata
    return computed


def load_cluster_members(
    connection, *, dataset_id: str, layout_version: str, cluster_ids: set[str]
):
    if not cluster_ids:
        return {}
    rows = connection.execute(
        """
        select cluster_id, node_id
        from cluster_members
        where dataset_id = %s
          and layout_version = %s
          and cluster_id = any(%s)
        order by cluster_id, node_id
        """,
        (dataset_id, layout_version, list(sorted(cluster_ids))),
    ).fetchall()
    grouped: dict[str, list[str]] = {}
    for row in rows:
        grouped.setdefault(row["cluster_id"], []).append(row["node_id"])
    return {cluster_id: tuple(node_ids) for cluster_id, node_ids in grouped.items()}


def read_viewport(
    connection,
    threshold_cache,
    *,
    dataset_id,
    layout_version,
    xmin,
    xmax,
    ymin,
    ymax,
    max_nodes,
    lod_level=None,
    cluster_id=None,
    focus_node_id=None,
):
    global_bounds = read_global_node_bounds(
        connection, dataset_id=dataset_id, layout_version=layout_version
    )
    if cluster_id:
        nodes, total_node_count = read_cluster_member_nodes(
            connection,
            dataset_id=dataset_id,
            layout_version=layout_version,
            cluster_id=cluster_id,
            max_nodes=max_nodes,
            focus_node_id=focus_node_id,
        )
        member_ids = {node.node_id for node in nodes}
        edges = tuple(
            read_edges_for_nodes(
                connection,
                dataset_id=dataset_id,
                layout_version=layout_version,
                node_ids=member_ids,
            )
        )
        meta_edges, neighbor_reps = read_expansion_meta_edges(
            connection,
            threshold_cache,
            dataset_id=dataset_id,
            layout_version=layout_version,
            cluster_id=cluster_id,
            member_ids=member_ids,
        )
        nodes = tuple(nodes) + tuple(neighbor_reps)
        enriched = attach_node_metadata(
            connection,
            dataset_id=dataset_id,
            layout_version=layout_version,
            nodes=nodes,
        )
        return ViewportReadResult(
            dataset_id=dataset_id,
            layout_version=layout_version,
            nodes=enriched,
            edges=edges + tuple(meta_edges),
            total_node_count=total_node_count,
            truncated=total_node_count > len(enriched),
            layout_status=aggregate_layout_status(
                {node.layout_status for node in nodes}
            ),
            global_bounds=global_bounds,
            metadata_schema=load_metadata_schema(
                connection, dataset_id=dataset_id, layout_version=layout_version
            ),
        )

    threshold = threshold_for_lod_level(
        connection,
        threshold_cache,
        dataset_id=dataset_id,
        layout_version=layout_version,
        lod_level=lod_level,
    )
    if lod_level == 0 and not has_bounds(xmin, xmax, ymin, ymax):
        nodes, total_node_count, edges = read_lod_zero_without_bounds(
            connection,
            threshold_cache,
            dataset_id=dataset_id,
            layout_version=layout_version,
            threshold=threshold,
            max_nodes=max_nodes,
        )
    elif threshold is None:
        nodes, total_node_count = read_ready_nodes(
            connection,
            dataset_id=dataset_id,
            layout_version=layout_version,
            xmin=xmin,
            xmax=xmax,
            ymin=ymin,
            ymax=ymax,
            max_nodes=max_nodes,
        )
        viewport_node_ids = {node.node_id for node in nodes}
        edges = tuple(
            read_edges_touching_nodes(
                connection,
                dataset_id=dataset_id,
                layout_version=layout_version,
                node_ids=viewport_node_ids,
            )
        )
        neighbor_ids = {
            endpoint
            for edge in edges
            for endpoint in (edge.source, edge.target)
            if endpoint not in viewport_node_ids
        }
        neighbors = tuple(
            read_node_positions_by_ids(
                connection,
                dataset_id=dataset_id,
                layout_version=layout_version,
                node_ids=neighbor_ids,
                max_nodes=len(neighbor_ids),
            )
            if neighbor_ids
            else ()
        )
        nodes = nodes + neighbors
        present_ids = viewport_node_ids | {node.node_id for node in neighbors}
        edges = tuple(
            edge
            for edge in edges
            if edge.source in present_ids and edge.target in present_ids
        )
        total_node_count += len(neighbors)
    else:
        nodes = read_cluster_representatives(
            connection,
            dataset_id=dataset_id,
            layout_version=layout_version,
            threshold=threshold,
            xmin=xmin,
            xmax=xmax,
            ymin=ymin,
            ymax=ymax,
            max_nodes=max_nodes,
        )
        total_node_count = count_clusters_for_threshold(
            connection,
            dataset_id=dataset_id,
            layout_version=layout_version,
            threshold=threshold,
            xmin=xmin,
            xmax=xmax,
            ymin=ymin,
            ymax=ymax,
        )
        edges = tuple(
            read_prepared_edges_for_nodes(
                connection,
                dataset_id=dataset_id,
                layout_version=layout_version,
                lod_level=lod_level or 0,
                node_ids={node.node_id for node in nodes},
            )
        )

    nodes = attach_node_metadata(
        connection, dataset_id=dataset_id, layout_version=layout_version, nodes=nodes
    )
    return ViewportReadResult(
        dataset_id=dataset_id,
        layout_version=layout_version,
        nodes=nodes,
        edges=tuple(edges),
        total_node_count=total_node_count,
        truncated=total_node_count > len(nodes),
        layout_status=aggregate_layout_status({node.layout_status for node in nodes}),
        global_bounds=global_bounds,
        metadata_schema=load_metadata_schema(
            connection, dataset_id=dataset_id, layout_version=layout_version
        ),
    )


def bounds_clause(prefix: str, xmin, xmax, ymin, ymax) -> tuple[str, tuple[Any, ...]]:
    if None in (xmin, xmax, ymin, ymax):
        return "", ()
    return f"and {prefix}.x between %s and %s and {prefix}.y between %s and %s", (
        xmin,
        xmax,
        ymin,
        ymax,
    )


def cluster_bounds_clause(xmin, xmax, ymin, ymax) -> tuple[str, tuple[Any, ...]]:
    if None in (xmin, xmax, ymin, ymax):
        return "", ()
    return "and max_x >= %s and min_x <= %s and max_y >= %s and min_y <= %s", (
        xmin,
        xmax,
        ymin,
        ymax,
    )


def read_global_node_bounds(connection, *, dataset_id, layout_version):
    row = connection.execute(
        """
        select min(x) as min_x, max(x) as max_x, min(y) as min_y, max(y) as max_y
        from node_positions
        where dataset_id = %s and layout_version = %s
        """,
        (dataset_id, layout_version),
    ).fetchone()
    if row is None or row["min_x"] is None:
        return None
    return LayoutBounds(
        min_x=row["min_x"], max_x=row["max_x"], min_y=row["min_y"], max_y=row["max_y"]
    )


def threshold_for_lod_level(
    connection, threshold_cache, *, dataset_id, layout_version, lod_level
):
    if lod_level is None:
        return None
    key = (dataset_id, layout_version)
    thresholds = threshold_cache.get(key)
    if thresholds is None:
        rows = connection.execute(
            """
            select distinct threshold
            from prepared_clusters
            where dataset_id = %s and layout_version = %s and threshold is not null
            order by threshold desc
            """,
            (dataset_id, layout_version),
        ).fetchall()
        thresholds = tuple(row["threshold"] for row in rows)
        threshold_cache[key] = thresholds
    if not thresholds:
        return None
    index = min(max(lod_level, 0), len(thresholds) - 1)
    threshold = thresholds[index]
    return None if threshold == thresholds[-1] else threshold


def read_lod_zero_without_bounds(
    connection, threshold_cache, *, dataset_id, layout_version, threshold, max_nodes
):
    if threshold is not None:
        nodes = read_cluster_representatives(
            connection,
            dataset_id=dataset_id,
            layout_version=layout_version,
            threshold=threshold,
            xmin=None,
            xmax=None,
            ymin=None,
            ymax=None,
            max_nodes=max_nodes,
        )
        total = count_clusters_for_threshold(
            connection,
            dataset_id=dataset_id,
            layout_version=layout_version,
            threshold=threshold,
            xmin=None,
            xmax=None,
            ymin=None,
            ymax=None,
        )
        if total > 1:
            return (
                nodes,
                total,
                tuple(
                    read_prepared_edges_for_nodes(
                        connection,
                        dataset_id=dataset_id,
                        layout_version=layout_version,
                        lod_level=0,
                        node_ids={node.node_id for node in nodes},
                    )
                ),
            )
    nodes, total = read_distinct_node_positions(
        connection,
        dataset_id=dataset_id,
        layout_version=layout_version,
        max_nodes=max_nodes,
    )
    return (
        nodes,
        total,
        tuple(
            read_edges_for_nodes(
                connection,
                dataset_id=dataset_id,
                layout_version=layout_version,
                node_ids={node.node_id for node in nodes},
            )
        ),
    )


def read_ready_nodes(
    connection, *, dataset_id, layout_version, xmin, xmax, ymin, ymax, max_nodes
):
    clause, params = bounds_clause("np", xmin, xmax, ymin, ymax)
    count_row = connection.execute(
        f"""
        select count(*) as total_count
        from node_positions np
        where np.dataset_id = %s and np.layout_version = %s {clause}
        """,
        (dataset_id, layout_version, *params),
    ).fetchone()
    rows = connection.execute(
        f"""
        select np.node_id, np.cluster_id, np.x, np.y, np.status
        from node_positions np
        where np.dataset_id = %s and np.layout_version = %s {clause}
        order by np.cluster_id, np.node_id
        limit %s
        """,
        (dataset_id, layout_version, *params, max_nodes),
    ).fetchall()
    return tuple(viewport_leaf_node(row) for row in rows), int(
        count_row["total_count"]
    ) if count_row else 0


def read_cluster_member_nodes(
    connection, *, dataset_id, layout_version, cluster_id, max_nodes, focus_node_id=None
):
    total_row = connection.execute(
        """
        select count(*) as total_count
        from cluster_members
        where dataset_id = %s and layout_version = %s and cluster_id = %s
        """,
        (dataset_id, layout_version, cluster_id),
    ).fetchone()
    rows = connection.execute(
        """
        select cm.node_id, cm.cluster_id, np.x, np.y, np.status
        from cluster_members cm
        join node_positions np
          on np.dataset_id = cm.dataset_id
         and np.layout_version = cm.layout_version
         and np.node_id = cm.node_id
        where cm.dataset_id = %s and cm.layout_version = %s and cm.cluster_id = %s
        order by case when np.node_id = %s then 0 else 1 end, np.node_id
        limit %s
        """,
        (dataset_id, layout_version, cluster_id, focus_node_id, max_nodes),
    ).fetchall()
    return tuple(viewport_leaf_node(row) for row in rows), int(
        total_row["total_count"]
    ) if total_row else 0


def read_expansion_meta_edges(
    connection, threshold_cache, *, dataset_id, layout_version, cluster_id, member_ids
):
    if not member_ids:
        return [], []
    row = connection.execute(
        """
        select threshold
        from prepared_clusters
        where dataset_id = %s and layout_version = %s and cluster_id = %s
        """,
        (dataset_id, layout_version, cluster_id),
    ).fetchone()
    if row is None or row["threshold"] is None:
        return [], []
    threshold = row["threshold"]
    boundary_rows = connection.execute(
        """
        select edge_id, source_node_id, target_node_id, distance
        from graph_edges
        where dataset_id = %s
          and layout_version = %s
          and (source_node_id = any(%s) or target_node_id = any(%s))
        order by source_node_id, target_node_id, edge_id
        """,
        (
            dataset_id,
            layout_version,
            list(sorted(member_ids)),
            list(sorted(member_ids)),
        ),
    ).fetchall()
    boundary = []
    outside_ids = set()
    for row in boundary_rows:
        source_inside = row["source_node_id"] in member_ids
        target_inside = row["target_node_id"] in member_ids
        if source_inside == target_inside:
            continue
        inside = row["source_node_id"] if source_inside else row["target_node_id"]
        outside = row["target_node_id"] if source_inside else row["source_node_id"]
        boundary.append((inside, outside, row["distance"]))
        outside_ids.add(outside)
    neighbor_reps = representatives_for_nodes(
        connection,
        dataset_id=dataset_id,
        layout_version=layout_version,
        threshold=threshold,
        node_ids=outside_ids,
    )
    bundled: dict[tuple[str, str], tuple[float | None, int]] = {}
    for inside, outside, distance in boundary:
        neighbor = neighbor_reps.get(outside)
        if neighbor is None or neighbor.node_id in member_ids:
            continue
        key = (inside, neighbor.node_id)
        existing = bundled.get(key)
        bundled[key] = (
            (min_distance(existing[0], distance), existing[1] + 1)
            if existing
            else (distance, 1)
        )
    meta_edges = [
        ViewportEdge(
            edge_id=f"meta_edge:{inside}:{rep_id}",
            source=inside,
            target=rep_id,
            distance=distance,
            is_meta=True,
            bundled_edge_count=count,
        )
        for (inside, rep_id), (distance, count) in sorted(bundled.items())
    ]
    surfaced_ids = {rep_id for (_inside, rep_id) in bundled}
    surfaced_by_id = {}
    for neighbor in neighbor_reps.values():
        if neighbor.node_id in surfaced_ids:
            surfaced_by_id.setdefault(neighbor.node_id, neighbor)
    return meta_edges, [surfaced_by_id[node_id] for node_id in sorted(surfaced_by_id)]


def representatives_for_nodes(
    connection, *, dataset_id, layout_version, threshold, node_ids
):
    if not node_ids:
        return {}
    rows = connection.execute(
        """
        select cm.node_id as node_id,
               pc.cluster_id as cluster_id,
               pc.representative_node_id as representative_node_id,
               pc.member_count as member_count,
               pc.x as x,
               pc.y as y,
               pc.status as status
        from cluster_members cm
        join prepared_clusters pc
          on pc.dataset_id = cm.dataset_id
         and pc.layout_version = cm.layout_version
         and pc.cluster_id = cm.cluster_id
        where cm.dataset_id = %s
          and cm.layout_version = %s
          and pc.threshold = %s
          and pc.x is not null
          and cm.node_id = any(%s)
        """,
        (dataset_id, layout_version, threshold, list(sorted(node_ids))),
    ).fetchall()
    return {
        row["node_id"]: ViewportNode(
            node_id=row["representative_node_id"],
            cluster_id=row["cluster_id"],
            x=row["x"],
            y=row["y"],
            layout_status=row["status"],
            member_count=row["member_count"],
            is_representative=True,
        )
        for row in rows
    }


def read_distinct_node_positions(connection, *, dataset_id, layout_version, max_nodes):
    total_row = connection.execute(
        "select count(*) as total_count from node_positions where dataset_id = %s and layout_version = %s",
        (dataset_id, layout_version),
    ).fetchone()
    rows = connection.execute(
        """
        select node_id, cluster_id, x, y, status
        from node_positions
        where dataset_id = %s and layout_version = %s
        order by node_id
        limit %s
        """,
        (dataset_id, layout_version, max_nodes),
    ).fetchall()
    return tuple(viewport_leaf_node(row) for row in rows), int(
        total_row["total_count"]
    ) if total_row else 0


def read_cluster_representatives(
    connection,
    *,
    dataset_id,
    layout_version,
    threshold,
    xmin,
    xmax,
    ymin,
    ymax,
    max_nodes,
):
    clause, params = cluster_bounds_clause(xmin, xmax, ymin, ymax)
    rows = connection.execute(
        f"""
        select cluster_id, representative_node_id, x, y, member_count, status
        from prepared_clusters
        where dataset_id = %s
          and layout_version = %s
          and threshold = %s
          and x is not null
          {clause}
        order by member_count desc, cluster_id
        limit %s
        """,
        (dataset_id, layout_version, threshold, *params, max_nodes),
    ).fetchall()
    return tuple(
        ViewportNode(
            node_id=row["representative_node_id"],
            cluster_id=row["cluster_id"],
            x=row["x"],
            y=row["y"],
            layout_status=row["status"],
            member_count=row["member_count"],
            is_representative=True,
        )
        for row in rows
    )


def count_clusters_for_threshold(
    connection, *, dataset_id, layout_version, threshold, xmin, xmax, ymin, ymax
):
    clause, params = cluster_bounds_clause(xmin, xmax, ymin, ymax)
    row = connection.execute(
        f"""
        select count(*) as total_count
        from prepared_clusters
        where dataset_id = %s
          and layout_version = %s
          and threshold = %s
          and x is not null
          {clause}
        """,
        (dataset_id, layout_version, threshold, *params),
    ).fetchone()
    return int(row["total_count"]) if row else 0


def read_prepared_edges_for_nodes(
    connection, *, dataset_id, layout_version, lod_level, node_ids
):
    if not node_ids:
        return ()
    rows = connection.execute(
        """
        select edge_id, source_node_id, target_node_id, distance
        from prepared_edges
        where dataset_id = %s
          and layout_version = %s
          and lod_level = %s
          and source_node_id = any(%s)
          and target_node_id = any(%s)
        order by source_node_id, target_node_id
        """,
        (
            dataset_id,
            layout_version,
            lod_level,
            list(sorted(node_ids)),
            list(sorted(node_ids)),
        ),
    ).fetchall()
    return tuple(viewport_edge(row) for row in rows)


def read_edges_for_nodes(connection, *, dataset_id, layout_version, node_ids):
    if not node_ids:
        return ()
    rows = connection.execute(
        """
        select edge_id, source_node_id, target_node_id, distance
        from graph_edges
        where dataset_id = %s
          and layout_version = %s
          and source_node_id = any(%s)
          and target_node_id = any(%s)
        order by source_node_id, target_node_id, edge_id
        """,
        (dataset_id, layout_version, list(sorted(node_ids)), list(sorted(node_ids))),
    ).fetchall()
    return tuple(viewport_edge(row) for row in rows)


def read_edges_touching_nodes(connection, *, dataset_id, layout_version, node_ids):
    if not node_ids:
        return ()
    rows = connection.execute(
        """
        select edge_id, source_node_id, target_node_id, distance
        from graph_edges
        where dataset_id = %s
          and layout_version = %s
          and (source_node_id = any(%s) or target_node_id = any(%s))
        order by source_node_id, target_node_id, edge_id
        """,
        (dataset_id, layout_version, list(sorted(node_ids)), list(sorted(node_ids))),
    ).fetchall()
    return tuple(viewport_edge(row) for row in rows)


def read_node_positions_by_ids(
    connection, *, dataset_id, layout_version, node_ids, max_nodes
):
    if not node_ids or max_nodes <= 0:
        return []
    rows = connection.execute(
        """
        select np.node_id, np.cluster_id, np.x, np.y, np.status
        from node_positions np
        where np.dataset_id = %s
          and np.layout_version = %s
          and np.node_id = any(%s)
        order by np.cluster_id, np.node_id
        limit %s
        """,
        (dataset_id, layout_version, list(sorted(node_ids)), max_nodes),
    ).fetchall()
    return [viewport_leaf_node(row) for row in rows]


def search_nodes(connection_context, *, dataset_id, layout_version, query, limit):
    needle = query.strip()
    if not needle:
        return SearchReadResult(
            dataset_id=dataset_id,
            layout_version=layout_version,
            query="",
            matches=(),
            total_count=0,
        )
    with connection_context as connection:
        best: dict[str, SearchMatch] = {}
        pattern = f"%{_escape_like(needle)}%"
        rows = connection.execute(
            """
            select distinct node_id
            from node_positions
            where dataset_id = %s
              and layout_version = %s
              and node_id ilike %s escape '\\'
            """,
            (dataset_id, layout_version, pattern),
        ).fetchall()
        lowered = needle.lower()
        for row in rows:
            node_id = row["node_id"]
            if _is_union_node_id(node_id):
                continue
            lower_id = node_id.lower()
            score = (
                SEARCH_SCORE_ID_EXACT
                if lower_id == lowered
                else SEARCH_SCORE_ID_PREFIX
                if lower_id.startswith(lowered)
                else SEARCH_SCORE_ID_SUBSTRING
            )
            record_match(best, node_id=node_id, score=score, matched_text=node_id)
        rows = connection.execute(
            """
            select node_id, metadata_json
            from node_metadata
            where dataset_id = %s
              and layout_version = %s
              and metadata_json ilike %s escape '\\'
            """,
            (dataset_id, layout_version, pattern),
        ).fetchall()
        for row in rows:
            node_id = row["node_id"]
            if _is_union_node_id(node_id):
                continue
            matched_value = _first_matching_value(
                json.loads(row["metadata_json"]), lowered
            )
            if matched_value is not None:
                record_match(
                    best,
                    node_id=node_id,
                    score=SEARCH_SCORE_METADATA_VALUE,
                    matched_text=f"{node_id} {matched_value}",
                )
        ordered = sorted(best.values(), key=lambda match: (-match.score, match.node_id))
        limited = list(ordered[:limit]) if limit >= 0 else list(ordered)
        locations = node_locations(
            connection,
            dataset_id=dataset_id,
            layout_version=layout_version,
            node_ids=[match.node_id for match in limited],
        )
    return SearchReadResult(
        dataset_id=dataset_id,
        layout_version=layout_version,
        query=needle,
        matches=tuple(
            replace(
                match,
                cluster_id=locations.get(match.node_id, (None, None, None))[0],
                x=locations.get(match.node_id, (None, None, None))[1],
                y=locations.get(match.node_id, (None, None, None))[2],
            )
            for match in limited
        ),
        total_count=len(ordered),
    )


def record_match(
    best: dict[str, SearchMatch], *, node_id: str, score: int, matched_text: str
) -> None:
    existing = best.get(node_id)
    if existing is None or existing.score < score:
        best[node_id] = SearchMatch(
            node_id=node_id, score=score, matched_text=matched_text
        )


def node_locations(connection, *, dataset_id, layout_version, node_ids):
    if not node_ids:
        return {}
    rows = connection.execute(
        """
        select node_id, cluster_id, x, y
        from node_positions
        where dataset_id = %s and layout_version = %s and node_id = any(%s)
        """,
        (dataset_id, layout_version, node_ids),
    ).fetchall()
    return {row["node_id"]: (row["cluster_id"], row["x"], row["y"]) for row in rows}


def viewport_leaf_node(row) -> ViewportNode:
    return ViewportNode(
        node_id=row["node_id"],
        cluster_id=row["cluster_id"],
        x=row["x"],
        y=row["y"],
        layout_status=row["status"],
        member_count=1,
    )


def viewport_edge(row) -> ViewportEdge:
    return ViewportEdge(
        edge_id=row["edge_id"],
        source=row["source_node_id"],
        target=row["target_node_id"],
        distance=row["distance"],
    )


def min_distance(left: float | None, right: float | None) -> float | None:
    if left is None:
        return right
    if right is None:
        return left
    return left if left <= right else right
