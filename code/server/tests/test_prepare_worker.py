from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from phylo_lens_server.cli.prepare_worker import run_postgres_prepare_worker
from phylo_lens_server.data.normalizer import NormalizeRequest, normalize_dataset
from phylo_lens_server.domain.models import CanonicalDataset
from phylo_lens_server.pipeline.worker import PreparedLayoutWorker
from phylo_lens_server.repository.jobs.postgres import (
    ClaimedPrepareJob,
    DurablePrepareJob,
)
from phylo_lens_server.repository.jobs.result_payload import prepare_result_payload
from phylo_lens_server.repository.layout.sqlite_layout_repository import (
    PreparedLayoutStore,
)


@dataclass
class FakeDurablePrepareJobStore:
    claimed_job: ClaimedPrepareJob | None
    ready_result: dict[str, Any] | None = None
    failed_error: str | None = None
    schema_asserted: bool = False
    heartbeat_count: int = 0
    heartbeat_result: bool = True

    def create_schema(self) -> None:
        raise NotImplementedError

    def assert_schema_current(self) -> None:
        self.schema_asserted = True

    def submit(self, *_args, **_kwargs) -> str:
        raise NotImplementedError

    def claim_next(self, *, worker_id: str, lease_seconds: int):
        job = self.claimed_job
        self.claimed_job = None
        return job

    def heartbeat(self, *, job_id: str, worker_id: str, lease_seconds: int) -> bool:
        self.heartbeat_count += 1
        return self.heartbeat_result

    def mark_ready(
        self,
        *,
        job_id: str,
        worker_id: str,
        result: dict[str, Any],
    ) -> bool:
        self.ready_result = result
        return True

    def mark_failed(self, *, job_id: str, worker_id: str, error: str) -> bool:
        self.failed_error = error
        return True

    def snapshot(self, job_id: str) -> DurablePrepareJob | None:
        return None


def _dataset(dataset_name: str = "worker-tree") -> CanonicalDataset:
    return normalize_dataset(
        NormalizeRequest(
            format="newick",
            dataset_name=dataset_name,
            content="(a:1,b:1)root;",
        )
    ).dataset


def test_postgres_prepare_worker_claims_prepares_and_marks_ready(tmp_path) -> None:
    dataset = _dataset()
    job_store = FakeDurablePrepareJobStore(
        ClaimedPrepareJob(job_id="job-1", dataset=dataset, warnings=("note",))
    )
    layout_store = PreparedLayoutStore(tmp_path / "prepared_layout")

    run_postgres_prepare_worker(
        job_store=job_store,
        layout_worker=PreparedLayoutWorker(layout_store),
        worker_id="worker-1",
        poll_interval_seconds=0.01,
        lease_seconds=30,
        max_jobs=1,
    )

    assert job_store.schema_asserted is True
    assert job_store.failed_error is None
    assert job_store.ready_result is not None
    expected_result = PreparedLayoutWorker(
        PreparedLayoutStore(tmp_path / "expected_layout")
    ).prepare_dataset(dataset)
    assert job_store.ready_result == prepare_result_payload(
        expected_result,
        ("note",),
    )
    assert layout_store.latest_layout_version("worker-tree")


def test_postgres_prepare_worker_does_not_fail_job_after_lease_loss(tmp_path) -> None:
    dataset = _dataset("lost-lease-tree")
    job_store = FakeDurablePrepareJobStore(
        ClaimedPrepareJob(job_id="job-1", dataset=dataset, warnings=()),
        heartbeat_result=False,
    )
    layout_store = PreparedLayoutStore(tmp_path / "prepared_layout")

    run_postgres_prepare_worker(
        job_store=job_store,
        layout_worker=PreparedLayoutWorker(layout_store),
        worker_id="worker-1",
        poll_interval_seconds=0.01,
        lease_seconds=30,
        max_jobs=1,
    )

    assert job_store.schema_asserted is True
    assert job_store.ready_result is None
    assert job_store.failed_error is None
    assert layout_store.latest_layout_version("lost-lease-tree") is None
