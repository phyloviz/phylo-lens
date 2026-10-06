"""Explicit persistence contracts used by application services."""

from collections.abc import Callable
from contextlib import AbstractContextManager
from typing import Protocol

from phylo_lens_server.domain.preparation import (
    ClusterLayout,
    NodeLayoutPosition,
    PreparedLayoutArtifacts,
    QuotientEdge,
)
from phylo_lens_server.domain.revisions import AncillaryReplacement, AncillarySource
from phylo_lens_server.domain.search import SearchReadResult
from phylo_lens_server.domain.views import (
    LayoutStatus,
    RegionReadResult,
    ViewportReadResult,
)


class AncillaryRevision(Protocol):
    source: AncillarySource

    def publish(self, replacement: AncillaryReplacement) -> str: ...


class LayoutRepository(Protocol):
    def latest_layout_version(self, dataset_id: str) -> str | None: ...
    def search_nodes(
        self, *, dataset_id: str, layout_version: str, query: str, limit: int
    ) -> SearchReadResult: ...
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
    ) -> RegionReadResult: ...
    def ancillary_revision(
        self, dataset_id: str, layout_version: str
    ) -> AbstractContextManager[AncillaryRevision]: ...
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
    ) -> dict[int, int]: ...
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
    ) -> ViewportReadResult: ...
    def clear_layout_version(self, dataset_id: str, layout_version: str) -> None: ...
    def save_artifacts(
        self,
        artifacts: PreparedLayoutArtifacts,
        *,
        status: LayoutStatus = "refining",
        stage_factory: Callable[[str], AbstractContextManager[None]] | None = None,
    ) -> None: ...
    def save_layouts(
        self,
        cluster_layouts: tuple[ClusterLayout, ...],
        node_positions: tuple[NodeLayoutPosition, ...],
        *,
        stage_factory: Callable[[str], AbstractContextManager[None]] | None = None,
    ) -> None: ...
    def save_prepared_edges(
        self,
        prepared_edges: tuple[QuotientEdge, ...],
        *,
        stage_factory: Callable[[str], AbstractContextManager[None]] | None = None,
    ) -> None: ...
    def publish_layout_version(
        self, *, dataset_id: str, layout_version: str, status: LayoutStatus
    ) -> None: ...
