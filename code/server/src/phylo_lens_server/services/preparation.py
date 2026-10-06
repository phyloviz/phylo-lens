from __future__ import annotations

import logging
from collections.abc import Callable
from contextlib import AbstractContextManager, contextmanager

from phylo_lens_server.domain.models import Dataset
from phylo_lens_server.domain.preparation import (
    PreparedLayoutResult,
    PrepareInput,
)
from phylo_lens_server.domain.sfdp import SfdpOptions
from phylo_lens_server.domain.views import LayoutStatus
from phylo_lens_server.jobs.models import (
    LayoutPublicationAbortedError,
    PrepareJob,
    PrepareJobs,
    PrepareJobSnapshot,
)
from phylo_lens_server.pipeline.ingestion import ingest_dataset
from phylo_lens_server.pipeline.layout import compute_prepared_layouts
from phylo_lens_server.pipeline.lod import (
    compute_prepared_edges,
    prepare_layout_artifacts,
)
from phylo_lens_server.repository.interfaces import LayoutRepository

logger = logging.getLogger(__name__)


class PreparationService:
    """Background-friendly worker that prepares and persists layout artifacts."""

    def __init__(
        self,
        store: LayoutRepository,
        stage_factory: Callable[[str], AbstractContextManager[None]] | None = None,
    ) -> None:
        self.store = store
        self._stage_factory = stage_factory

    def prepare_dataset(
        self,
        dataset: Dataset,
        *,
        sfdp_options: SfdpOptions | None = None,
        should_continue: Callable[[], bool] | None = None,
    ) -> PreparedLayoutResult:
        with self._stage("lod_construction"):
            artifacts = prepare_layout_artifacts(dataset, sfdp_options=sfdp_options)
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
            cluster_layouts, node_positions = compute_prepared_layouts(artifacts)
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


def ensure_should_continue(should_continue: Callable[[], bool] | None) -> None:
    if should_continue is not None and not should_continue():
        raise LayoutPublicationAbortedError(
            "Layout preparation lost job ownership before publication."
        )


def prepare_graph_job(
    request: PrepareInput,
    registry: PrepareJobs,
) -> PrepareJob:
    with registry.reserve_capacity() as reserved_capacity:
        ingested = ingest_dataset(request, include_summary_schema=True)
        dataset = ingested.dataset
        job_id = registry.submit(
            dataset,
            ingested.warnings,
            sfdp_options=request.sfdp_options,
            reserved_capacity=reserved_capacity,
        )
    return PrepareJob(
        job_id=job_id,
        status="pending",
        dataset_id=dataset.dataset_id,
    )


def prepare_graph_status(job_id: str, registry: PrepareJobs) -> PrepareJobSnapshot:
    snapshot = registry.snapshot(job_id)
    if snapshot is None:
        raise KeyError(job_id)

    return snapshot
