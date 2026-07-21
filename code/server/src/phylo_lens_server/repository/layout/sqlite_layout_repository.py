from __future__ import annotations

from collections.abc import Callable
from contextlib import AbstractContextManager
from pathlib import Path

from phylo_lens_server.pipeline.models import (
    ClusterLayout,
    LayoutBounds,
    LayoutStatus,
    NodeLayoutPosition,
    PreparedLayoutArtifacts,
    PreparedEdge,
    RegionReadResult,
    SearchReadResult,
    ViewportReadResult,
)
from phylo_lens_server.database.sqlite import (
    database_path_for_root,
    connect,
    initialize_schema,
)
from . import node_search, region_reader, viewport_reader, writer


class PreparedLayoutStore:
    """SQLite store for materialized layout artifacts consumed by a read API."""

    def __init__(self, root: Path | str) -> None:
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self._database_path = database_path_for_root(self.root)
        self.path = self._database_path
        self._threshold_cache: dict[tuple[str, str], tuple[float, ...]] = {}
        initialize_schema(self._database_path)

    def clear_dataset(self, dataset_id: str) -> None:
        writer.clear_dataset(self._database_path, dataset_id, self._threshold_cache)

    def clear_layout_version(self, dataset_id: str, layout_version: str) -> None:
        writer.clear_layout_version(
            self._database_path,
            dataset_id=dataset_id,
            layout_version=layout_version,
            threshold_cache=self._threshold_cache,
        )

    def save_artifacts(
        self,
        artifacts: PreparedLayoutArtifacts,
        *,
        status: str = "refining",
        stage_factory: Callable[[str], AbstractContextManager[None]] | None = None,
    ) -> None:
        writer.save_artifacts(
            self._database_path,
            artifacts,
            status=status,
            stage_factory=stage_factory,
        )

    def save_layouts(
        self,
        cluster_layouts: tuple[ClusterLayout, ...],
        node_positions: tuple[NodeLayoutPosition, ...],
        *,
        stage_factory: Callable[[str], AbstractContextManager[None]] | None = None,
    ) -> None:
        writer.save_layouts(
            self._database_path,
            cluster_layouts,
            node_positions,
            stage_factory=stage_factory,
        )

    def save_prepared_edges(
        self,
        prepared_edges: tuple[PreparedEdge, ...],
        *,
        stage_factory: Callable[[str], AbstractContextManager[None]] | None = None,
    ) -> None:
        writer.save_prepared_edges(
            self._database_path,
            prepared_edges,
            stage_factory=stage_factory,
        )

    def publish_layout_version(
        self,
        *,
        dataset_id: str,
        layout_version: str,
        status: LayoutStatus,
    ) -> None:
        writer.publish_layout_version(
            self._database_path,
            dataset_id=dataset_id,
            layout_version=layout_version,
            status=status,
        )

    def load_cluster_layouts(
        self,
        dataset_id: str,
        layout_version: str,
    ) -> list[ClusterLayout]:
        with connect(self._database_path) as connection:
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
        with connect(self._database_path) as connection:
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
        with connect(self._database_path) as connection:
            row = connection.execute(
                """
                select layout_version
                from datasets
                where dataset_id = ?
                  and status in ('ready', 'degraded')
                order by updated_at desc, created_at desc, rowid desc
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
        focus_node_id: str | None = None,
    ) -> ViewportReadResult:
        return viewport_reader.read_viewport(
            self._database_path,
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
        return region_reader.read_region(
            self._database_path,
            dataset_id=dataset_id,
            layout_version=layout_version,
            xmin=xmin,
            xmax=xmax,
            ymin=ymin,
            ymax=ymax,
            max_nodes=max_nodes,
        )

    def search_nodes(
        self,
        *,
        dataset_id: str,
        layout_version: str,
        query: str,
        limit: int,
    ) -> SearchReadResult:
        return node_search.search_nodes(
            self._database_path,
            dataset_id=dataset_id,
            layout_version=layout_version,
            query=query,
            limit=limit,
        )
