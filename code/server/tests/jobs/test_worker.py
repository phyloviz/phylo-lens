from __future__ import annotations

from phylo_lens_server.domain.models import Dataset
from phylo_lens_server.domain.preparation import PreparationSummary
from phylo_lens_server.http.graph.schemas import NormalizeRequest
from phylo_lens_server.jobs.worker import run_postgres_prepare_worker
from phylo_lens_server.pipeline.ingestion import ingest_dataset
from phylo_lens_server.repository.jobs.postgres import (
    ClaimedPrepareJob,
)
from phylo_lens_server.repository.layout.sqlite_layout_repository import (
    SQLiteLayoutRepository,
)
from phylo_lens_server.services.preparation import PreparationService
from tests.support.durable_store import RecordingDurableStore


def _dataset(dataset_name: str = "worker-tree") -> Dataset:
    return ingest_dataset(
        NormalizeRequest(
            format="newick",
            dataset_name=dataset_name,
            content="(a:1,b:1)root;",
        ).to_domain()
    ).dataset


def test_postgres_prepare_worker_claims_prepares_and_marks_ready(tmp_path) -> None:
    dataset = _dataset()
    job_store = RecordingDurableStore(
        claimed_job=ClaimedPrepareJob(
            job_id="job-1", dataset=dataset, warnings=("note",)
        )
    )
    layout_store = SQLiteLayoutRepository(tmp_path / "prepared_layout")

    run_postgres_prepare_worker(
        job_store=job_store,
        layout_worker=PreparationService(layout_store),
        worker_id="worker-1",
        poll_interval_seconds=0.01,
        lease_seconds=30,
        max_jobs=1,
    )

    assert job_store.schema_asserted is True
    assert job_store.failed_error is None
    assert job_store.ready_result is not None
    expected_result = PreparationService(
        SQLiteLayoutRepository(tmp_path / "expected_layout")
    ).prepare_dataset(dataset)
    assert job_store.ready_result.model_dump(
        mode="json"
    ) == PreparationSummary.from_result(
        expected_result,
        ("note",),
    ).model_dump(mode="json")
    assert layout_store.latest_layout_version("worker-tree")


def test_postgres_prepare_worker_does_not_fail_job_after_lease_loss(tmp_path) -> None:
    dataset = _dataset("lost-lease-tree")
    job_store = RecordingDurableStore(
        claimed_job=ClaimedPrepareJob(job_id="job-1", dataset=dataset, warnings=()),
        heartbeat_result=False,
    )
    layout_store = SQLiteLayoutRepository(tmp_path / "prepared_layout")

    run_postgres_prepare_worker(
        job_store=job_store,
        layout_worker=PreparationService(layout_store),
        worker_id="worker-1",
        poll_interval_seconds=0.01,
        lease_seconds=30,
        max_jobs=1,
    )

    assert job_store.schema_asserted is True
    assert job_store.ready_result is None
    assert job_store.failed_error is None
    assert layout_store.latest_layout_version("lost-lease-tree") is None
