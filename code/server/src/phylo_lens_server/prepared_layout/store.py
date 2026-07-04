from __future__ import annotations

from collections import Counter
from dataclasses import replace
import json
from pathlib import Path
import sqlite3

from phylo_lens_server.core.metadata_keys import is_internal_metadata_key
from phylo_lens_server.prepared_layout.models import (
    ClusterLayout,
    LayoutBounds,
    LayoutStatus,
    MetadataSchemaField,
    NodeLayoutPosition,
    PreparedLayoutArtifacts,
    PreparedEdge,
    ViewportEdge,
    ViewportNode,
    ViewportReadResult,
)

DEFAULT_DB_NAME = "prepared_layout.sqlite3"

MetadataValue = str | float | bool | None
MetadataMap = dict[str, MetadataValue]


def aggregate_layout_status(statuses: set[LayoutStatus]) -> LayoutStatus:
    """Collapse per-row layout statuses into one status for a viewport.

    Precedence keeps degraded layouts honest: a failed row wins, then a
    ``"degraded"`` (circular-fallback) row, so a fallback layout never surfaces
    as ``"ready"``. A viewport is ``"ready"`` only when every row is ready; a
    non-empty mix is ``"refining"``; an empty set is ``"pending"``.
    """
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
    """Reduce member metadata to one value per field for a cluster representative.

    Numeric fields use the mean of non-null values; every other field type uses
    the most common non-null value with a deterministic alphabetical tie-break.
    """
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
                "node_metadata",
                "cluster_metadata",
                "metadata_schema",
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
            self._persist_metadata(connection, artifacts)

    def _persist_metadata(
        self,
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
            node_id: {
                key: value
                for key, value in metadata.items()
                if key in public_keys
            }
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
                select cluster_id, node_id, x, y, status
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
        """Read one viewport, choosing among four mutually exclusive read paths.

        1. ``cluster_id`` set: expand a single cluster into its member nodes.
        2. ``lod_level == 0`` with no bounds: the coarse overview, which reads
           cluster representatives for the coarsest threshold (or falls back to
           distinct node positions when the tree resolves to one cluster).
        3. no threshold for this level: individual "ready" nodes within bounds.
        4. otherwise: cluster representatives for the level's threshold, within
           bounds.

        Bounds filtering applies to the representative and ready-node paths; the
        cluster-expansion path (1) intentionally ignores bounds so an opened
        cluster always returns all of its members.
        """
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
                layout_status = aggregate_layout_status(
                    {node.layout_status for node in nodes}
                )
                enriched = self._attach_node_metadata(
                    connection,
                    dataset_id=dataset_id,
                    layout_version=layout_version,
                    nodes=tuple(nodes),
                )
                return ViewportReadResult(
                    dataset_id=dataset_id,
                    layout_version=layout_version,
                    nodes=enriched,
                    edges=tuple(edges),
                    total_node_count=total_node_count,
                    truncated=total_node_count > len(enriched),
                    layout_status=layout_status,
                    metadata_schema=self._load_metadata_schema(
                        connection,
                        dataset_id=dataset_id,
                        layout_version=layout_version,
                    ),
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
                viewport_node_ids = {node.node_id for node in nodes}
                edges = self._read_edges_touching_nodes(
                    connection,
                    dataset_id=dataset_id,
                    layout_version=layout_version,
                    node_ids=viewport_node_ids,
                )
                # Edges straddling the viewport boundary reference a neighbor
                # just off-screen. Surface those neighbor positions so the
                # client keeps the boundary edges instead of dropping them for
                # a missing endpoint. These neighbors are a connectivity aid,
                # not part of the in-viewport slice, so they are surfaced in
                # full even when the viewport slice already fills ``max_nodes``.
                # Capping them to the leftover budget (which collapses to zero
                # in dense viewports) is what previously dropped boundary edges
                # again. Neighbors are a small fraction of the slice, so the
                # bounded overflow is acceptable.
                neighbor_ids = {
                    endpoint
                    for edge in edges
                    for endpoint in (edge.source, edge.target)
                    if endpoint not in viewport_node_ids
                }
                neighbors = tuple(
                    self._read_node_positions_by_ids(
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
                # Drop edges whose off-screen endpoint could not be surfaced
                # (budget exhausted) so both endpoints of every returned edge
                # are always present for the client.
                present_ids = viewport_node_ids | {
                    node.node_id for node in neighbors
                }
                edges = [
                    edge
                    for edge in edges
                    if edge.source in present_ids and edge.target in present_ids
                ]
                # Count surfaced neighbors into the total so the truncation
                # check keeps reflecting whether the in-viewport slice was
                # capped.
                total_node_count += len(neighbors)
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

            nodes = self._attach_node_metadata(
                connection,
                dataset_id=dataset_id,
                layout_version=layout_version,
                nodes=nodes,
            )
            metadata_schema = self._load_metadata_schema(
                connection,
                dataset_id=dataset_id,
                layout_version=layout_version,
            )

        layout_status = aggregate_layout_status(
            {node.layout_status for node in nodes}
        )
        return ViewportReadResult(
            dataset_id=dataset_id,
            layout_version=layout_version,
            nodes=nodes,
            edges=tuple(edges),
            total_node_count=total_node_count,
            truncated=total_node_count > len(nodes),
            layout_status=layout_status,
            metadata_schema=metadata_schema,
        )

    def _attach_node_metadata(
        self,
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
        node_metadata = self._load_metadata_rows(
            connection,
            table="node_metadata",
            key_column="node_id",
            dataset_id=dataset_id,
            layout_version=layout_version,
            keys=node_ids,
        )
        cluster_metadata = self._load_metadata_rows(
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

    def _load_metadata_rows(
        self,
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

    def _load_metadata_schema(
        self,
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

    def _read_edges_touching_nodes(
        self,
        connection: sqlite3.Connection,
        *,
        dataset_id: str,
        layout_version: str,
        node_ids: set[str],
    ) -> list[ViewportEdge]:
        """Edges with at least one endpoint in ``node_ids``.

        Unlike :meth:`_read_edges_for_nodes`, which requires both endpoints in
        the set, this keeps edges that straddle the viewport boundary so a
        bounds-filtered slice stays connected to its off-screen neighbors.
        """
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
              and (source_node_id in ({placeholders})
                   or target_node_id in ({placeholders}))
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

    def _read_node_positions_by_ids(
        self,
        connection: sqlite3.Connection,
        *,
        dataset_id: str,
        layout_version: str,
        node_ids: set[str],
        max_nodes: int,
    ) -> list[ViewportNode]:
        """Fetch positions for specific node ids at the finest partition.

        Used to surface off-screen boundary-edge neighbors so the client keeps
        edges that cross the viewport edge. Capped by ``max_nodes`` so the
        connectivity aid never overruns the viewport node budget.
        """
        if not node_ids or max_nodes <= 0:
            return []
        placeholders = ",".join("?" for _ in node_ids)
        rows = connection.execute(
            f"""
            with base_threshold as (
                select min(threshold) as value
                from prepared_clusters
                where dataset_id = ? and layout_version = ?
            )
            select np.node_id, np.cluster_id, np.x, np.y, np.status
            from node_positions np
            join prepared_clusters pc
              on pc.dataset_id = np.dataset_id
             and pc.layout_version = np.layout_version
             and pc.cluster_id = np.cluster_id
            where np.dataset_id = ?
              and np.layout_version = ?
              and pc.threshold = (select value from base_threshold)
              and np.node_id in ({placeholders})
            order by np.cluster_id, np.node_id
            limit ?
            """,
            (
                dataset_id,
                layout_version,
                dataset_id,
                layout_version,
                *sorted(node_ids),
                max_nodes,
            ),
        ).fetchall()
        return [
            ViewportNode(
                node_id=row["node_id"],
                cluster_id=row["cluster_id"],
                x=row["x"],
                y=row["y"],
                layout_status=row["status"],
                member_count=1,
            )
            for row in rows
        ]

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        # WAL lets viewport readers proceed against the last committed snapshot
        # while a prepare write is in flight; NORMAL trades a fsync-per-commit
        # for the WAL checkpoint's durability, which is the right balance for a
        # rebuildable materialized-layout cache.
        connection.execute("pragma journal_mode=WAL")
        connection.execute("pragma synchronous=NORMAL")
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
                    status text not null,
                    primary key(dataset_id, layout_version, cluster_id, node_id)
                );

                create table if not exists node_metadata(
                    dataset_id text not null,
                    layout_version text not null,
                    node_id text not null,
                    metadata_json text not null,
                    primary key(dataset_id, layout_version, node_id)
                );

                create table if not exists cluster_metadata(
                    dataset_id text not null,
                    layout_version text not null,
                    cluster_id text not null,
                    metadata_json text not null,
                    primary key(dataset_id, layout_version, cluster_id)
                );

                create table if not exists metadata_schema(
                    dataset_id text not null,
                    layout_version text not null,
                    field_key text not null,
                    field_type text not null,
                    primary key(dataset_id, layout_version, field_key)
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
