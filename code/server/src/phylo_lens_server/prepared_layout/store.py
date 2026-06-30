from __future__ import annotations

from pathlib import Path
import sqlite3

from phylo_lens_server.prepared_layout.models import (
    ClusterLayout,
    LayoutBounds,
    NodeLayoutPosition,
    PreparedLayoutArtifacts,
    PreparedEdge,
    ViewportEdge,
    ViewportNode,
    ViewportReadResult,
)

DEFAULT_DB_NAME = "prepared_layout.sqlite3"


def optional_node_bounds_filter(
    *,
    xmin: float | None,
    xmax: float | None,
    ymin: float | None,
    ymax: float | None,
) -> tuple[str, tuple[float, ...]]:
    if None in (xmin, xmax, ymin, ymax):
        return "", ()
    return "and np.x between ? and ? and np.y between ? and ?", (
        xmin,
        xmax,
        ymin,
        ymax,
    )


def optional_cluster_bounds_filter(
    *,
    xmin: float | None,
    xmax: float | None,
    ymin: float | None,
    ymax: float | None,
) -> tuple[str, tuple[float, ...]]:
    if None in (xmin, xmax, ymin, ymax):
        return "", ()
    return "and max_x >= ? and min_x <= ? and max_y >= ? and min_y <= ?", (
        xmin,
        xmax,
        ymin,
        ymax,
    )


def has_bounds(
    xmin: float | None,
    xmax: float | None,
    ymin: float | None,
    ymax: float | None,
) -> bool:
    return None not in (xmin, xmax, ymin, ymax)


class PreparedLayoutStore:
    """SQLite store for materialized layout artifacts consumed by a read API."""

    def __init__(self, root: Path | str) -> None:
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.path = self.root / DEFAULT_DB_NAME
        self._init_schema()

    def clear_dataset(self, dataset_id: str) -> None:
        with self._connect() as connection:
            for table in (
                "node_positions",
                "prepared_edges",
                "graph_edges",
                "cluster_members",
                "prepared_clusters",
                "datasets",
                "cluster_edges",
            ):
                if not self._table_exists(connection, table):
                    continue
                connection.execute(
                    f"delete from {table} where dataset_id = ?",
                    (dataset_id,),
                )

    def save_artifacts(self, artifacts: PreparedLayoutArtifacts) -> None:
        with self._connect() as connection:
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

    def save_layouts(
        self,
        cluster_layouts: tuple[ClusterLayout, ...],
        node_positions: tuple[NodeLayoutPosition, ...],
    ) -> None:
        with self._connect() as connection:
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
                    x, y, lod_min, lod_max, status
                )
                values (?, ?, ?, ?, ?, ?, ?, ?, ?)
                on conflict(dataset_id, layout_version, cluster_id, node_id)
                do update set
                    x = excluded.x,
                    y = excluded.y,
                    lod_min = excluded.lod_min,
                    lod_max = excluded.lod_max,
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
                        position.lod_min,
                        position.lod_max,
                        position.status,
                    )
                    for position in node_positions
                ],
            )
            if cluster_layouts:
                first = cluster_layouts[0]
                connection.execute(
                    """
                    update datasets set status = ?
                    where dataset_id = ? and layout_version = ?
                    """,
                    ("ready", first.dataset_id, first.layout_version),
                )

    def save_prepared_edges(self, prepared_edges: tuple[PreparedEdge, ...]) -> None:
        if not prepared_edges:
            return
        with self._connect() as connection:
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

    def load_cluster_layouts(
        self,
        dataset_id: str,
        layout_version: str,
    ) -> list[ClusterLayout]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                select cluster_id, representative_node_id, member_count,
                       x, y, radius, min_x, max_x, min_y, max_y, status
                from prepared_clusters
                where dataset_id = ? and layout_version = ? and x is not null
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
        self,
        dataset_id: str,
        layout_version: str,
    ) -> list[NodeLayoutPosition]:
        with self._connect() as connection:
            rows = connection.execute(
                """
                select cluster_id, node_id, x, y, lod_min, lod_max, status
                from node_positions
                where dataset_id = ? and layout_version = ?
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
                lod_min=row["lod_min"],
                lod_max=row["lod_max"],
                status=row["status"],
            )
            for row in rows
        ]

    def latest_layout_version(self, dataset_id: str) -> str | None:
        with self._connect() as connection:
            row = connection.execute(
                """
                select layout_version
                from datasets
                where dataset_id = ?
                order by updated_at desc, created_at desc, layout_version desc
                limit 1
                """,
                (dataset_id,),
            ).fetchone()
        return None if row is None else row["layout_version"]

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
    ) -> ViewportReadResult:
        with self._connect() as connection:
            if cluster_id:
                nodes, total_node_count = self._read_cluster_member_nodes(
                    connection,
                    dataset_id=dataset_id,
                    layout_version=layout_version,
                    cluster_id=cluster_id,
                    max_nodes=max_nodes,
                )
                edges = self._read_edges_for_nodes(
                    connection,
                    dataset_id=dataset_id,
                    layout_version=layout_version,
                    node_ids={node.node_id for node in nodes},
                )
                statuses = {node.layout_status for node in nodes}
                layout_status = (
                    "ready"
                    if statuses == {"ready"}
                    else "refining"
                    if statuses
                    else "pending"
                )
                return ViewportReadResult(
                    dataset_id=dataset_id,
                    layout_version=layout_version,
                    nodes=tuple(nodes),
                    edges=tuple(edges),
                    total_node_count=total_node_count,
                    truncated=total_node_count > len(nodes),
                    layout_status=layout_status,
                )

            threshold = self._threshold_for_lod_level(
                connection,
                dataset_id=dataset_id,
                layout_version=layout_version,
                lod_level=lod_level,
            )
            if lod_level == 0 and not has_bounds(xmin, xmax, ymin, ymax):
                nodes, total_node_count, edges = self._read_lod_zero_without_bounds(
                    connection,
                    dataset_id=dataset_id,
                    layout_version=layout_version,
                    threshold=threshold,
                    max_nodes=max_nodes,
                )
            elif threshold is None:
                ready_nodes, total_node_count = self._read_ready_nodes(
                    connection,
                    dataset_id=dataset_id,
                    layout_version=layout_version,
                    xmin=xmin,
                    xmax=xmax,
                    ymin=ymin,
                    ymax=ymax,
                    max_nodes=max_nodes,
                )
                nodes: tuple[ViewportNode, ...] = tuple(ready_nodes)
                edges = self._read_edges_for_nodes(
                    connection,
                    dataset_id=dataset_id,
                    layout_version=layout_version,
                    node_ids={node.node_id for node in nodes},
                )
            else:
                nodes = tuple(
                    self._read_cluster_representatives(
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
                )
                total_node_count = self._count_clusters_for_threshold(
                    connection,
                    dataset_id=dataset_id,
                    layout_version=layout_version,
                    threshold=threshold,
                    xmin=xmin,
                    xmax=xmax,
                    ymin=ymin,
                    ymax=ymax,
                )
                edges = self._read_prepared_edges_for_nodes(
                    connection,
                    dataset_id=dataset_id,
                    layout_version=layout_version,
                    lod_level=lod_level or 0,
                    node_ids={node.node_id for node in nodes},
                )

        statuses = {node.layout_status for node in nodes}
        layout_status = (
            "ready" if statuses == {"ready"} else "refining" if statuses else "pending"
        )
        return ViewportReadResult(
            dataset_id=dataset_id,
            layout_version=layout_version,
            nodes=nodes,
            edges=tuple(edges),
            total_node_count=total_node_count,
            truncated=total_node_count > len(nodes),
            layout_status=layout_status,
        )

    def _read_lod_zero_without_bounds(
        self,
        connection: sqlite3.Connection,
        *,
        dataset_id: str,
        layout_version: str,
        threshold: float | None,
        max_nodes: int,
    ) -> tuple[tuple[ViewportNode, ...], int, list[ViewportEdge]]:
        if threshold is not None:
            nodes = tuple(
                self._read_cluster_representatives(
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
            )
            total_node_count = self._count_clusters_for_threshold(
                connection,
                dataset_id=dataset_id,
                layout_version=layout_version,
                threshold=threshold,
                xmin=None,
                xmax=None,
                ymin=None,
                ymax=None,
            )
            if total_node_count > 1:
                return (
                    nodes,
                    total_node_count,
                    self._read_prepared_edges_for_nodes(
                        connection,
                        dataset_id=dataset_id,
                        layout_version=layout_version,
                        lod_level=0,
                        node_ids={node.node_id for node in nodes},
                    ),
                )

        nodes, total_node_count = self._read_distinct_node_positions(
            connection,
            dataset_id=dataset_id,
            layout_version=layout_version,
            max_nodes=max_nodes,
        )
        return (
            tuple(nodes),
            total_node_count,
            self._read_edges_for_nodes(
                connection,
                dataset_id=dataset_id,
                layout_version=layout_version,
                node_ids={node.node_id for node in nodes},
            ),
        )

    def _threshold_for_lod_level(
        self,
        connection: sqlite3.Connection,
        *,
        dataset_id: str,
        layout_version: str,
        lod_level: int | None,
    ) -> float | None:
        if lod_level is None or lod_level >= 1:
            return None
        rows = connection.execute(
            """
            select distinct threshold
            from prepared_clusters
            where dataset_id = ?
              and layout_version = ?
              and threshold is not null
            order by threshold desc
            """,
            (dataset_id, layout_version),
        ).fetchall()
        if not rows:
            return None
        index = min(max(lod_level, 0), len(rows) - 1)
        threshold = rows[index]["threshold"]
        min_threshold = rows[-1]["threshold"]
        return None if threshold == min_threshold else threshold

    def _read_ready_nodes(
        self,
        connection: sqlite3.Connection,
        *,
        dataset_id: str,
        layout_version: str,
        xmin: float | None,
        xmax: float | None,
        ymin: float | None,
        ymax: float | None,
        max_nodes: int,
    ) -> tuple[list[ViewportNode], int]:
        bounds_filter, bounds_params = optional_node_bounds_filter(
            xmin=xmin,
            xmax=xmax,
            ymin=ymin,
            ymax=ymax,
        )
        rows = connection.execute(
            f"""
            with base_threshold as (
                select min(threshold) as value
                from prepared_clusters
                where dataset_id = ? and layout_version = ?
            )
            select np.node_id, np.cluster_id, np.x, np.y, np.status,
                   count(*) over() as total_count
            from node_positions np
            join prepared_clusters pc
              on pc.dataset_id = np.dataset_id
             and pc.layout_version = np.layout_version
             and pc.cluster_id = np.cluster_id
            where np.dataset_id = ?
              and np.layout_version = ?
              and pc.threshold = (select value from base_threshold)
              {bounds_filter}
            order by np.cluster_id, np.node_id
            limit ?
            """,
            (
                dataset_id,
                layout_version,
                dataset_id,
                layout_version,
                *bounds_params,
                max_nodes,
            ),
        ).fetchall()
        total = int(rows[0]["total_count"]) if rows else 0
        return (
            [
                ViewportNode(
                    node_id=row["node_id"],
                    cluster_id=row["cluster_id"],
                    x=row["x"],
                    y=row["y"],
                    layout_status=row["status"],
                    member_count=1,
                )
                for row in rows
            ],
            total,
        )

    def _read_cluster_member_nodes(
        self,
        connection: sqlite3.Connection,
        *,
        dataset_id: str,
        layout_version: str,
        cluster_id: str,
        max_nodes: int,
    ) -> tuple[list[ViewportNode], int]:
        rows = connection.execute(
            """
            select np.node_id, np.cluster_id, np.x, np.y, np.status,
                   count(*) over() as total_count
            from node_positions np
            where np.dataset_id = ?
              and np.layout_version = ?
              and np.cluster_id = ?
            order by np.node_id
            limit ?
            """,
            (dataset_id, layout_version, cluster_id, max_nodes),
        ).fetchall()
        total = int(rows[0]["total_count"]) if rows else 0
        return (
            [
                ViewportNode(
                    node_id=row["node_id"],
                    cluster_id=row["cluster_id"],
                    x=row["x"],
                    y=row["y"],
                    layout_status=row["status"],
                    member_count=1,
                    is_representative=False,
                )
                for row in rows
            ],
            total,
        )

    def _read_distinct_node_positions(
        self,
        connection: sqlite3.Connection,
        *,
        dataset_id: str,
        layout_version: str,
        max_nodes: int,
    ) -> tuple[list[ViewportNode], int]:
        rows = connection.execute(
            """
            select node_id, cluster_id, x, y, status,
                   count(*) over() as total_count
            from (
                select node_id,
                       min(cluster_id) as cluster_id,
                       x,
                       y,
                       max(status) as status
                from node_positions
                where dataset_id = ?
                  and layout_version = ?
                  and lod_min <= 0
                  and lod_max >= 0
                group by node_id, x, y
            )
            order by node_id
            limit ?
            """,
            (dataset_id, layout_version, max_nodes),
        ).fetchall()
        total = int(rows[0]["total_count"]) if rows else 0
        return (
            [
                ViewportNode(
                    node_id=row["node_id"],
                    cluster_id=row["cluster_id"],
                    x=row["x"],
                    y=row["y"],
                    layout_status=row["status"],
                    member_count=1,
                )
                for row in rows
            ],
            total,
        )

    def _read_cluster_representatives(
        self,
        connection: sqlite3.Connection,
        *,
        dataset_id: str,
        layout_version: str,
        threshold: float,
        xmin: float | None,
        xmax: float | None,
        ymin: float | None,
        ymax: float | None,
        max_nodes: int,
    ) -> list[ViewportNode]:
        bounds_filter, bounds_params = optional_cluster_bounds_filter(
            xmin=xmin,
            xmax=xmax,
            ymin=ymin,
            ymax=ymax,
        )
        rows = connection.execute(
            f"""
            select cluster_id, representative_node_id, x, y, member_count, status
            from prepared_clusters
            where dataset_id = ?
              and layout_version = ?
              and threshold = ?
              and x is not null
              {bounds_filter}
            order by member_count desc, cluster_id
            limit ?
            """,
            (
                dataset_id,
                layout_version,
                threshold,
                *bounds_params,
                max_nodes,
            ),
        ).fetchall()
        return [
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
        ]

    def _count_clusters_for_threshold(
        self,
        connection: sqlite3.Connection,
        *,
        dataset_id: str,
        layout_version: str,
        threshold: float,
        xmin: float | None,
        xmax: float | None,
        ymin: float | None,
        ymax: float | None,
    ) -> int:
        bounds_filter, bounds_params = optional_cluster_bounds_filter(
            xmin=xmin,
            xmax=xmax,
            ymin=ymin,
            ymax=ymax,
        )
        row = connection.execute(
            f"""
            select count(*) as total_count
            from prepared_clusters
            where dataset_id = ?
              and layout_version = ?
              and threshold = ?
              and x is not null
              {bounds_filter}
            """,
            (dataset_id, layout_version, threshold, *bounds_params),
        ).fetchone()
        return int(row["total_count"]) if row is not None else 0

    def _read_prepared_edges_for_nodes(
        self,
        connection: sqlite3.Connection,
        *,
        dataset_id: str,
        layout_version: str,
        lod_level: int,
        node_ids: set[str],
    ) -> list[ViewportEdge]:
        if not node_ids:
            return []
        placeholders = ",".join("?" for _ in node_ids)
        sorted_node_ids = sorted(node_ids)
        rows = connection.execute(
            f"""
            select edge_id, source_node_id, target_node_id, distance
            from prepared_edges
            where dataset_id = ?
              and layout_version = ?
              and lod_level = ?
              and source_node_id in ({placeholders})
              and target_node_id in ({placeholders})
            order by source_node_id, target_node_id
            """,
            (
                dataset_id,
                layout_version,
                lod_level,
                *sorted_node_ids,
                *sorted_node_ids,
            ),
        ).fetchall()
        return [
            ViewportEdge(
                edge_id=row["edge_id"],
                source=row["source_node_id"],
                target=row["target_node_id"],
                distance=row["distance"],
            )
            for row in rows
        ]

    def _read_edges_for_nodes(
        self,
        connection: sqlite3.Connection,
        *,
        dataset_id: str,
        layout_version: str,
        node_ids: set[str],
    ) -> list[ViewportEdge]:
        if not node_ids:
            return []
        placeholders = ",".join("?" for _ in node_ids)
        params = [
            dataset_id,
            layout_version,
            *sorted(node_ids),
            *sorted(node_ids),
        ]
        rows = connection.execute(
            f"""
            select edge_id, source_node_id, target_node_id, distance
            from graph_edges
            where dataset_id = ?
              and layout_version = ?
              and source_node_id in ({placeholders})
              and target_node_id in ({placeholders})
            order by source_node_id, target_node_id, edge_id
            """,
            params,
        ).fetchall()
        return [
            ViewportEdge(
                edge_id=row["edge_id"],
                source=row["source_node_id"],
                target=row["target_node_id"],
                distance=row["distance"],
            )
            for row in rows
        ]

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        return connection

    def _table_exists(self, connection: sqlite3.Connection, table_name: str) -> bool:
        row = connection.execute(
            """
            select 1
            from sqlite_master
            where type = 'table' and name = ?
            """,
            (table_name,),
        ).fetchone()
        return row is not None

    def _init_schema(self) -> None:
        with self._connect() as connection:
            connection.executescript(
                """
                create table if not exists datasets(
                    dataset_id text not null,
                    layout_version text not null,
                    status text not null,
                    created_at text not null default current_timestamp,
                    updated_at text not null default current_timestamp,
                    primary key(dataset_id, layout_version)
                );

                create table if not exists prepared_clusters(
                    dataset_id text not null,
                    layout_version text not null,
                    cluster_id text not null,
                    threshold real,
                    representative_node_id text,
                    member_count integer not null default 0,
                    x real,
                    y real,
                    radius real,
                    min_x real,
                    max_x real,
                    min_y real,
                    max_y real,
                    status text not null,
                    primary key(dataset_id, layout_version, cluster_id)
                );

                create table if not exists cluster_members(
                    dataset_id text not null,
                    layout_version text not null,
                    cluster_id text not null,
                    node_id text not null,
                    primary key(dataset_id, layout_version, cluster_id, node_id)
                );

                create table if not exists graph_edges(
                    dataset_id text not null,
                    layout_version text not null,
                    edge_id text not null,
                    source_node_id text not null,
                    target_node_id text not null,
                    distance real,
                    primary key(dataset_id, layout_version, edge_id)
                );

                create table if not exists prepared_edges(
                    dataset_id text not null,
                    layout_version text not null,
                    lod_level integer not null,
                    edge_id text not null,
                    source_node_id text not null,
                    target_node_id text not null,
                    distance real,
                    primary key(dataset_id, layout_version, lod_level, edge_id)
                );

                create table if not exists node_positions(
                    dataset_id text not null,
                    layout_version text not null,
                    cluster_id text not null,
                    node_id text not null,
                    x real not null,
                    y real not null,
                    lod_min integer not null,
                    lod_max integer not null,
                    status text not null,
                    primary key(dataset_id, layout_version, cluster_id, node_id)
                );

                create index if not exists idx_node_positions_xy
                on node_positions(dataset_id, layout_version, x, y);

                create index if not exists idx_graph_edges_endpoints
                on graph_edges(
                    dataset_id, layout_version, source_node_id, target_node_id
                );

                create index if not exists idx_prepared_edges_endpoints
                on prepared_edges(
                    dataset_id, layout_version, lod_level,
                    source_node_id, target_node_id
                );

                create index if not exists idx_prepared_clusters_bounds
                on prepared_clusters(
                    dataset_id, layout_version, min_x, max_x, min_y, max_y
                );

                create index if not exists idx_prepared_clusters_threshold
                on prepared_clusters(dataset_id, layout_version, threshold);
                """
            )
