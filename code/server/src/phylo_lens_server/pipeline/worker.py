from __future__ import annotations

import logging
from collections.abc import Callable
from concurrent.futures import Future, ThreadPoolExecutor
from contextlib import AbstractContextManager, contextmanager

from phylo_lens_server.domain.models import CanonicalDataset
from phylo_lens_server.pipeline.ingest import prepare_layout_artifacts
from phylo_lens_server.pipeline.layout import compute_prepared_layouts
from phylo_lens_server.pipeline.models import (
    LayoutStatus,
    PreparedEdge,
    PreparedLayoutArtifacts,
    PreparedLayoutResult,
)
from phylo_lens_server.repository.layout.sqlite_layout_repository import (
    PreparedLayoutStore,
)

logger = logging.getLogger(__name__)


class PreparedLayoutWorker:
    """Background-friendly worker that prepares and persists layout artifacts."""

    def __init__(
        self,
        store: PreparedLayoutStore,
        executor: ThreadPoolExecutor | None = None,
        stage_factory: Callable[[str], AbstractContextManager[None]] | None = None,
    ) -> None:
        self.store = store
        self._executor = executor
        self._owns_executor = executor is None
        self._stage_factory = stage_factory

    def prepare_dataset(
        self,
        dataset: CanonicalDataset,
        *,
        should_continue: Callable[[], bool] | None = None,
    ) -> PreparedLayoutResult:
        with self._stage("lod_construction"):
            artifacts = prepare_layout_artifacts(dataset)
        ensure_should_continue(should_continue)
        with self._stage("persistence.clear"):
            self.store.clear_layout_version(
                artifacts.dataset.dataset_id,
                artifacts.layout_version,
            )
        self.store.save_artifacts(
            artifacts,
            status="refining",
            stage_factory=self._stage,
        )
        with self._stage("index_construction"):
            prepared_edges = compute_prepared_edges(artifacts)
        with self._stage("base_layout"):
            cluster_layouts, node_positions, degraded_reason = compute_prepared_layouts(
                artifacts
            )
        ensure_should_continue(should_continue)
        self.store.save_layouts(
            cluster_layouts,
            node_positions,
            stage_factory=self._stage,
        )
        ensure_should_continue(should_continue)
        self.store.save_prepared_edges(
            prepared_edges,
            stage_factory=self._stage,
        )
        layout_status: LayoutStatus = (
            cluster_layouts[0].status
            if cluster_layouts
            else node_positions[0].status
            if node_positions
            else "ready"
        )
        ensure_should_continue(should_continue)
        with self._stage("persistence.publish"):
            self.store.publish_layout_version(
                dataset_id=artifacts.dataset.dataset_id,
                layout_version=artifacts.layout_version,
                status=layout_status,
            )
        return PreparedLayoutResult(
            artifacts=artifacts,
            cluster_layouts=cluster_layouts,
            node_positions=node_positions,
            prepared_edges=prepared_edges,
            layout_status=layout_status,
            layout_degraded_reason=degraded_reason,
        )

    @contextmanager
    def _stage(self, name: str):
        """Run optional internal instrumentation without affecting preparation.

        Evaluation callbacks are observational. Their factory, enter, and exit
        failures are logged and ignored; exceptions from the preparation body
        still propagate unchanged.
        """
        if self._stage_factory is None:
            yield
            return
        try:
            stage = self._stage_factory(name)
            stage.__enter__()
        except Exception:
            logger.exception("Ignoring failed internal stage instrumentation: %s", name)
            yield
            return

        body_error = None
        try:
            yield
        except BaseException as error:
            body_error = error
            raise
        finally:
            try:
                stage.__exit__(
                    type(body_error) if body_error is not None else None,
                    body_error,
                    body_error.__traceback__ if body_error is not None else None,
                )
            except Exception:
                logger.exception(
                    "Ignoring failed internal stage instrumentation cleanup: %s", name
                )

    @property
    def executor(self) -> ThreadPoolExecutor:
        if self._executor is None:
            self._executor = ThreadPoolExecutor(max_workers=1)
        return self._executor

    def submit_prepare_dataset(
        self,
        dataset: CanonicalDataset,
    ) -> Future[PreparedLayoutResult]:
        return self.executor.submit(self.prepare_dataset, dataset)

    def shutdown(self) -> None:
        if self._owns_executor and self._executor is not None:
            self._executor.shutdown(wait=True)


class LayoutPublicationAbortedError(RuntimeError):
    """Raised when publication is stopped before writing layout artifacts."""


def compute_prepared_edges(
    artifacts: PreparedLayoutArtifacts,
) -> tuple[PreparedEdge, ...]:
    prepared_by_key: dict[tuple[int, str, str], PreparedEdge] = {}
    thresholds = tuple(
        sorted(
            {
                cluster.threshold
                for cluster in artifacts.clusters
                if cluster.threshold is not None
            },
            reverse=True,
        )
    )

    for lod_level, threshold in enumerate(thresholds):
        clusters = tuple(
            cluster for cluster in artifacts.clusters if cluster.threshold == threshold
        )
        node_to_rep = {
            node_id: cluster.representative_node_id
            for cluster in clusters
            for node_id in cluster.member_node_ids
        }

        for edge in artifacts.dataset.edges:
            source_rep = node_to_rep.get(edge.source)
            target_rep = node_to_rep.get(edge.target)
            if source_rep is None or target_rep is None or source_rep == target_rep:
                continue

            source, target = sorted((source_rep, target_rep))
            key = (lod_level, source, target)
            current = prepared_by_key.get(key)
            if current is not None and _edge_distance(current) <= _raw_distance(
                edge.distance
            ):
                continue

            prepared_by_key[key] = PreparedEdge(
                dataset_id=artifacts.dataset.dataset_id,
                layout_version=artifacts.layout_version,
                lod_level=lod_level,
                edge_id=f"quotient_edge:{lod_level}:{source}:{target}",
                source=source,
                target=target,
                distance=edge.distance,
            )

    return tuple(
        prepared_by_key[key]
        for key in sorted(prepared_by_key, key=lambda item: (item[0], item[1], item[2]))
    )


def _edge_distance(edge: PreparedEdge) -> float:
    return _raw_distance(edge.distance)


def _raw_distance(distance: float | None) -> float:
    return float("inf") if distance is None else distance


def ensure_should_continue(should_continue: Callable[[], bool] | None) -> None:
    if should_continue is not None and not should_continue():
        raise LayoutPublicationAbortedError(
            "Layout preparation lost job ownership before publication."
        )
