from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

from phylo_lens_server.database.postgres import connect
from phylo_lens_server.database.sql import LayoutSQL
from phylo_lens_server.domain.preparation import (
    ClusterLayout,
    NodeLayoutPosition,
    PreparedLayoutArtifacts,
    QuotientEdge,
)
from phylo_lens_server.domain.search import SearchReadResult
from phylo_lens_server.domain.views import (
    LayoutStatus,
    RegionReadResult,
    ViewportReadResult,
)
from phylo_lens_server.repository.layout import (
    ancillary_revision,
    geometry_reader,
    region_reader,
    viewport_reader,
    writer,
)
from phylo_lens_server.repository.layout.lod_reader import (
    read_viewport_representation_counts,
)
from phylo_lens_server.repository.layout.node_search import search_nodes


class PostgresLayoutRepository:
    """Postgres store for materialized layout artifacts and viewport reads."""

    def __init__(self, dsn: str) -> None:
        self._dsn = dsn
        self.path = dsn

    @contextmanager
    def ancillary_revision(
        self, dataset_id: str, layout_version: str
    ) -> Iterator[ancillary_revision.AncillaryRevision]:
        with self._connect() as connection, connection.transaction():
            yield ancillary_revision.open_revision(
                connection, dataset_id, layout_version, "%s"
            )

    def clear_dataset(self, dataset_id: str) -> None:
        with self._connect() as connection, connection.transaction():
            writer.clear_dataset(LayoutSQL(connection, "postgres"), dataset_id)

    def clear_layout_version(self, dataset_id: str, layout_version: str) -> None:
        with self._connect() as connection, connection.transaction():
            writer.clear_dataset(
                LayoutSQL(connection, "postgres"), dataset_id, layout_version
            )

    def save_artifacts(
        self,
        artifacts: PreparedLayoutArtifacts,
        *,
        status: LayoutStatus = "refining",
        stage_factory: writer.StageFactory | None = None,
    ) -> None:
        with self._connect() as connection, connection.transaction():
            writer.save_artifacts(
                LayoutSQL(connection, "postgres"),
                artifacts,
                status=status,
                stage_factory=stage_factory,
            )

    def save_layouts(
        self,
        cluster_layouts: tuple[ClusterLayout, ...],
        node_positions: tuple[NodeLayoutPosition, ...],
        *,
        stage_factory: writer.StageFactory | None = None,
    ) -> None:
        with self._connect() as connection, connection.transaction():
            writer.save_layouts(
                LayoutSQL(connection, "postgres"),
                cluster_layouts,
                node_positions,
                stage_factory=stage_factory,
            )

    def save_prepared_edges(
        self,
        prepared_edges: tuple[QuotientEdge, ...],
        *,
        stage_factory: writer.StageFactory | None = None,
    ) -> None:
        if not prepared_edges:
            return
        with self._connect() as connection, connection.transaction():
            writer.save_prepared_edges(
                LayoutSQL(connection, "postgres"),
                prepared_edges,
                stage_factory=stage_factory,
            )

    def publish_layout_version(
        self, *, dataset_id: str, layout_version: str, status: LayoutStatus
    ) -> None:
        with self._connect() as connection:
            writer.publish_layout_version(
                LayoutSQL(connection, "postgres"),
                dataset_id=dataset_id,
                layout_version=layout_version,
                status=status,
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
            return geometry_reader.load_cluster_layouts(
                LayoutSQL(connection, "postgres"), dataset_id, layout_version
            )

    def load_node_positions(
        self, dataset_id: str, layout_version: str
    ) -> list[NodeLayoutPosition]:
        with self._connect() as connection:
            return geometry_reader.load_node_positions(
                LayoutSQL(connection, "postgres"), dataset_id, layout_version
            )

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
            return viewport_reader.read_viewport(
                LayoutSQL(connection, "postgres"),
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
        with self._connect() as connection:
            return region_reader.read_region(
                LayoutSQL(connection, "postgres"),
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
        with self._connect() as connection:
            return search_nodes(
                connection,
                dataset_id=dataset_id,
                layout_version=layout_version,
                query=query,
                limit=limit,
                placeholder="%s",
                like_operator="ilike",
            )

    def _connect(self):
        return connect(self._dsn)
