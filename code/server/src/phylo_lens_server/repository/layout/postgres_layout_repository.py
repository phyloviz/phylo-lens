from __future__ import annotations

import json
from collections.abc import Iterable
from dataclasses import replace
from typing import Any

from phylo_lens_server.data.normalizer import AncillaryDataRequest, AncillaryReplacement
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
from phylo_lens_server.repository.jobs.postgres import import_psycopg
from phylo_lens_server.repository.layout import (
    ancillary_revision,
    region_reader,
    writer,
)
from phylo_lens_server.repository.layout.ancillary_distribution import (
    load_cluster_distributions,
)
from phylo_lens_server.repository.layout.isolate_membership import (
    load_isolates,
    search_isolates,
)
from phylo_lens_server.repository.layout.metadata_reader import (
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

SQLRow = tuple[Any, ...]
BULK_INSERT_BATCH_SIZE = writer.BULK_INSERT_BATCH_SIZE

from phylo_lens_server.repository.layout.lod_reader import (
    read_viewport_representation_counts,
)


class PostgresPreparedLayoutStore:
    """Postgres store for materialized layout artifacts and viewport reads."""

    def __init__(self, dsn: str) -> None:
        self._dsn = dsn
        self.path = dsn

    def apply_ancillary_data(
        self, dataset_id: str, layout_version: str, request: AncillaryDataRequest
    ) -> tuple[str, AncillaryReplacement]:
        with self._connect() as connection, connection.transaction():
            return ancillary_revision.apply_replacement(
                connection, dataset_id, layout_version, request, "%s"
            )

    def clear_dataset(self, dataset_id: str) -> None:
        with self._connect() as connection, connection.transaction():
            for table in layout_tables():
                connection.execute(
                    f"delete from {table} where dataset_id = %s", (dataset_id,)
                )

    def clear_layout_version(self, dataset_id: str, layout_version: str) -> None:
        with self._connect() as connection, connection.transaction():
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
        with self._connect() as connection, connection.transaction():
            writer.save_artifacts_to_connection(
                connection,
                artifacts,
                status=status,
                stage_factory=stage_factory,
                placeholder="%s",
                execute_many=execute_many_chunked,
            )

    def save_layouts(
        self,
        cluster_layouts: tuple[ClusterLayout, ...],
        node_positions: tuple[NodeLayoutPosition, ...],
        *,
        stage_factory=None,
    ) -> None:
        with self._connect() as connection, connection.transaction():
            writer.save_layouts_to_connection(
                connection,
                cluster_layouts,
                node_positions,
                stage_factory=stage_factory,
                placeholder="%s",
                execute_many=execute_many_chunked,
            )

    def save_prepared_edges(
        self,
        prepared_edges: tuple[PreparedEdge, ...],
        *,
        stage_factory=None,
    ) -> None:
        if not prepared_edges:
            return
        with self._connect() as connection, connection.transaction():
            writer.save_prepared_edges_to_connection(
                connection,
                prepared_edges,
                stage_factory=stage_factory,
                placeholder="%s",
                execute_many=execute_many_chunked,
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

    def viewport_representation_counts(
        self,
        *,
        dataset_id: str,
        layout_version: str,
        xmin: float | None,
        xmax: float | None,
        ymin: float | None,
        ymax: float | None,
        max_lod_level: int | None = None,
    ) -> dict[int, int]:
        with self._connect() as connection:
            return read_viewport_representation_counts(
                connection,
                dataset_id=dataset_id,
                layout_version=layout_version,
                xmin=xmin,
                xmax=xmax,
                ymin=ymin,
                ymax=ymax,
                placeholder="%s",
                max_lod_level=max_lod_level,
            )

    def read_viewport(
        self,
        *,
        dataset_id: str,
        layout_version: str,
        xmin: float | None,
        xmax: float | None,
        ymin: float | None,
        ymax: float | None,
        max_nodes: int | None = None,
        lod_level: int | None = None,
        cluster_id: str | None = None,
        focus_node_id: str | None = None,
    ) -> ViewportReadResult:
        with self._connect() as connection:
            return read_viewport(
                connection,
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
        max_nodes: int | None = None,
    ) -> RegionReadResult:
        return region_reader.read_region(
            self._connect(),
            dataset_id=dataset_id,
            layout_version=layout_version,
            xmin=xmin,
            xmax=xmax,
            ymin=ymin,
            ymax=ymax,
            max_nodes=max_nodes,
            read_ready_nodes_fn=read_ready_nodes,
            read_edges_for_nodes_fn=read_edges_for_nodes,
            attach_node_metadata_fn=attach_node_metadata,
            load_metadata_schema_fn=load_metadata_schema,
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


def layout_tables() -> tuple[str, ...]:
    return (
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
        (dataset_id, layout_version, sorted(keys)),
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
    isolates = load_isolates(
        connection,
        dataset_id=dataset_id,
        layout_version=layout_version,
        node_ids={node.node_id for node in nodes if node.member_count == 1},
        placeholder="%s",
    )
    distributions = load_cluster_distributions(
        connection,
        dataset_id=dataset_id,
        layout_version=layout_version,
        cluster_ids=cluster_ids,
        placeholder="%s",
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
        (dataset_id, layout_version, sorted(cluster_ids)),
    ).fetchall()
    grouped: dict[str, list[str]] = {}
    for row in rows:
        grouped.setdefault(row["cluster_id"], []).append(row["node_id"])
    return {cluster_id: tuple(node_ids) for cluster_id, node_ids in grouped.items()}


def read_viewport(
    connection,
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
        members_truncated = max_nodes is not None and total_node_count > len(nodes)
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
            truncated=members_truncated,
            layout_status=aggregate_layout_status(
                {node.layout_status for node in nodes}
            ),
            global_bounds=global_bounds,
            metadata_schema=load_metadata_schema(
                connection, dataset_id=dataset_id, layout_version=layout_version
            ),
        )

    cluster_level = cluster_level_for_lod_level(
        connection,
        dataset_id=dataset_id,
        layout_version=layout_version,
        lod_level=lod_level,
    )
    if cluster_level is None:
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
                max_nodes=None,
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
        truncated = max_nodes is not None and total_node_count > len(nodes) - len(
            neighbors
        )
        total_node_count += len(neighbors)
    else:
        nodes = read_cluster_representatives(
            connection,
            dataset_id=dataset_id,
            layout_version=layout_version,
            cluster_level=cluster_level,
            xmin=xmin,
            xmax=xmax,
            ymin=ymin,
            ymax=ymax,
            max_nodes=max_nodes,
        )
        total_node_count = count_clusters_for_cluster_level(
            connection,
            dataset_id=dataset_id,
            layout_version=layout_version,
            cluster_level=cluster_level,
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
        truncated=(
            truncated
            if cluster_level is None
            else max_nodes is not None and total_node_count > len(nodes)
        ),
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


def cluster_level_for_lod_level(connection, *, dataset_id, layout_version, lod_level):
    if lod_level is None:
        return None
    row = connection.execute(
        """
        select max(lod_level) as finest_level
        from prepared_clusters
        where dataset_id = %s and layout_version = %s
        """,
        (dataset_id, layout_version),
    ).fetchone()
    finest = row["finest_level"] if row else None
    if finest is None:
        return None
    level = max(0, lod_level)
    return level if level < finest else None


def read_ready_nodes(
    connection, *, dataset_id, layout_version, xmin, xmax, ymin, ymax, max_nodes
):
    limit_clause = "limit %s" if max_nodes is not None else ""
    limit_params = (max_nodes,) if max_nodes is not None else ()
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
        {limit_clause}
        """,
        (dataset_id, layout_version, *params, *limit_params),
    ).fetchall()
    return tuple(viewport_leaf_node(row) for row in rows), (
        int(count_row["total_count"]) if count_row else 0
    )


def read_cluster_member_nodes(
    connection, *, dataset_id, layout_version, cluster_id, max_nodes, focus_node_id=None
):
    limit_clause = "limit %s" if max_nodes is not None else ""
    limit_params = (max_nodes,) if max_nodes is not None else ()
    total_row = connection.execute(
        """
        select count(*) as total_count
        from cluster_members
        where dataset_id = %s and layout_version = %s and cluster_id = %s
        """,
        (dataset_id, layout_version, cluster_id),
    ).fetchone()
    rows = connection.execute(
        f"""
        select cm.node_id, cm.cluster_id, np.x, np.y, np.status
        from cluster_members cm
        join node_positions np
          on np.dataset_id = cm.dataset_id
         and np.layout_version = cm.layout_version
         and np.node_id = cm.node_id
        where cm.dataset_id = %s and cm.layout_version = %s and cm.cluster_id = %s
        order by case when np.node_id = %s then 0 else 1 end, np.node_id
        {limit_clause}
        """,
        (dataset_id, layout_version, cluster_id, focus_node_id, *limit_params),
    ).fetchall()
    return tuple(viewport_leaf_node(row) for row in rows), (
        int(total_row["total_count"]) if total_row else 0
    )


def read_expansion_meta_edges(
    connection,
    *,
    dataset_id,
    layout_version,
    cluster_id,
    member_ids,
):
    if not member_ids:
        return [], []
    row = connection.execute(
        """
        select lod_level, representative_node_id, member_count
        from prepared_clusters
        where dataset_id = %s and layout_version = %s and cluster_id = %s
        """,
        (dataset_id, layout_version, cluster_id),
    ).fetchone()
    if row is None:
        return [], []
    cluster_level = row["lod_level"]
    attachment = row["representative_node_id"]
    boundary_rows = connection.execute(
        """
        select e.source_node_id, e.target_node_id, e.distance
        from graph_edges e
        where e.dataset_id = %s and e.layout_version = %s
          and (e.source_node_id = %s or e.target_node_id = %s)
          and not exists (
            select 1 from cluster_members cm
            where cm.dataset_id = e.dataset_id
              and cm.layout_version = e.layout_version
              and cm.cluster_id = %s
              and cm.node_id = case when e.source_node_id = %s
                  then e.target_node_id else e.source_node_id end
          )
        order by e.source_node_id, e.target_node_id
        """,
        (dataset_id, layout_version, attachment, attachment, cluster_id, attachment),
    ).fetchall()
    if row["member_count"] > 1 and len(boundary_rows) != 1:
        raise ValueError("A collapsed subtree must have one external edge.")
    if attachment not in member_ids or not boundary_rows:
        return [], []
    outside_ids = {
        item["target_node_id"]
        if item["source_node_id"] == attachment
        else item["source_node_id"]
        for item in boundary_rows
    }
    neighbor_reps = representatives_for_nodes(
        connection,
        dataset_id=dataset_id,
        layout_version=layout_version,
        cluster_level=cluster_level,
        node_ids=outside_ids,
    )
    meta_edges = []
    surfaced_by_id = {}
    for item in boundary_rows:
        outside = (
            item["target_node_id"]
            if item["source_node_id"] == attachment
            else item["source_node_id"]
        )
        neighbor = neighbor_reps.get(outside)
        if neighbor is None or neighbor.node_id in member_ids:
            continue
        meta_edges.append(
            ViewportEdge(
                edge_id=f"meta_edge:{attachment}:{neighbor.node_id}",
                source=attachment,
                target=neighbor.node_id,
                distance=item["distance"],
                is_meta=True,
            )
        )
        surfaced_by_id[neighbor.node_id] = neighbor
    return meta_edges, [surfaced_by_id[node_id] for node_id in sorted(surfaced_by_id)]


def representatives_for_nodes(
    connection, *, dataset_id, layout_version, cluster_level, node_ids
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
          and pc.lod_level = %s
          and pc.x is not null
          and cm.node_id = any(%s)
        """,
        (dataset_id, layout_version, cluster_level, sorted(node_ids)),
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


def read_cluster_representatives(
    connection,
    *,
    dataset_id,
    layout_version,
    cluster_level,
    xmin,
    xmax,
    ymin,
    ymax,
    max_nodes,
):
    limit_clause = "limit %s" if max_nodes is not None else ""
    limit_params = (max_nodes,) if max_nodes is not None else ()
    clause, params = cluster_bounds_clause(xmin, xmax, ymin, ymax)
    rows = connection.execute(
        f"""
        select cluster_id, representative_node_id, x, y, member_count, status
        from prepared_clusters
        where dataset_id = %s
          and layout_version = %s
          and lod_level = %s
          and x is not null
          {clause}
        order by member_count desc, cluster_id
        {limit_clause}
        """,
        (dataset_id, layout_version, cluster_level, *params, *limit_params),
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


def count_clusters_for_cluster_level(
    connection, *, dataset_id, layout_version, cluster_level, xmin, xmax, ymin, ymax
):
    clause, params = cluster_bounds_clause(xmin, xmax, ymin, ymax)
    row = connection.execute(
        f"""
        select count(*) as total_count
        from prepared_clusters
        where dataset_id = %s
          and layout_version = %s
          and lod_level = %s
          and x is not null
          {clause}
        """,
        (dataset_id, layout_version, cluster_level, *params),
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
            sorted(node_ids),
            sorted(node_ids),
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
        (dataset_id, layout_version, sorted(node_ids), sorted(node_ids)),
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
        (dataset_id, layout_version, sorted(node_ids), sorted(node_ids)),
    ).fetchall()
    return tuple(viewport_edge(row) for row in rows)


def read_node_positions_by_ids(
    connection, *, dataset_id, layout_version, node_ids, max_nodes
):
    limit_clause = "limit %s" if max_nodes is not None else ""
    limit_params = (max_nodes,) if max_nodes is not None else ()
    if not node_ids or (max_nodes is not None and max_nodes <= 0):
        return []
    rows = connection.execute(
        f"""
        select np.node_id, np.cluster_id, np.x, np.y, np.status
        from node_positions np
        where np.dataset_id = %s
          and np.layout_version = %s
          and np.node_id = any(%s)
        order by np.cluster_id, np.node_id
        {limit_clause}
        """,
        (dataset_id, layout_version, sorted(node_ids), *limit_params),
    ).fetchall()
    return [viewport_leaf_node(row) for row in rows]


def search_nodes(connection_context, *, dataset_id, layout_version, query, limit):
    normalized_query = query.strip()
    if not normalized_query:
        return SearchReadResult(
            dataset_id=dataset_id,
            layout_version=layout_version,
            query="",
            matches=(),
            total_count=0,
        )
    with connection_context as connection:
        best: dict[str, SearchMatch] = {}
        pattern = f"%{_escape_like(normalized_query)}%"
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
        normalized_query_lower = normalized_query.lower()
        for row in rows:
            node_id = row["node_id"]
            if _is_union_node_id(node_id):
                continue
            normalized_node_id = node_id.lower()
            score = (
                SEARCH_SCORE_ID_EXACT
                if normalized_node_id == normalized_query_lower
                else (
                    SEARCH_SCORE_ID_PREFIX
                    if normalized_node_id.startswith(normalized_query_lower)
                    else SEARCH_SCORE_ID_SUBSTRING
                )
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
                json.loads(row["metadata_json"]), normalized_query_lower
            )
            if matched_value is not None:
                record_match(
                    best,
                    node_id=node_id,
                    score=SEARCH_SCORE_METADATA_VALUE,
                    matched_text=f"{node_id} {matched_value}",
                )
        search_isolates(
            connection,
            dataset_id=dataset_id,
            layout_version=layout_version,
            needle=normalized_query,
            best=best,
            record_match=record_match,
            placeholder="%s",
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
        query=normalized_query,
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
