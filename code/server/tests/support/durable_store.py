"""Record durable-worker interactions without simulating a database engine."""

from dataclasses import dataclass, field
from typing import override

from phylo_lens_server.domain.lod import LodOptions
from phylo_lens_server.domain.models import Dataset
from phylo_lens_server.domain.preparation import PreparationSummary
from phylo_lens_server.domain.sfdp import SfdpOptions
from phylo_lens_server.jobs.models import FailureDetails
from phylo_lens_server.repository.jobs.postgres import (
    DEFAULT_LEASE_SECONDS,
    ClaimedPrepareJob,
    DurablePrepareJob,
    DurablePrepareJobStore,
)


@dataclass
class RecordingDurableStore(DurablePrepareJobStore):
    snapshot_record: DurablePrepareJob | None = None
    claimed_job: ClaimedPrepareJob | None = None
    submit_result: str | None = None
    submitted: list[tuple[str, tuple[str, ...], int | None]] = field(
        default_factory=list
    )
    schema_asserted: bool = False
    ready_result: PreparationSummary | None = None
    failed_error: str | None = None
    failed_error_details: FailureDetails | None = None
    heartbeat_count: int = 0
    heartbeat_result: bool = True

    @override
    def create_schema(self) -> None:
        raise AssertionError("Runtime jobs must not initialize the database schema.")

    @override
    def assert_schema_current(self) -> None:
        self.schema_asserted = True

    @override
    def submit(
        self,
        dataset: Dataset,
        warnings: tuple[str, ...] = (),
        *,
        sfdp_options: SfdpOptions | None = None,
        lod_options: LodOptions | None = None,
        max_active_jobs: int | None = None,
    ) -> str:
        if self.submit_result is None:
            raise AssertionError(
                "Configure the expected submission result in this scenario."
            )
        self.submitted.append((dataset.dataset_id, warnings, max_active_jobs))
        return self.submit_result

    @override
    def claim_next(
        self, *, worker_id: str, lease_seconds: int = DEFAULT_LEASE_SECONDS
    ) -> ClaimedPrepareJob | None:
        job = self.claimed_job
        self.claimed_job = None
        return job

    @override
    def heartbeat(
        self, *, job_id: str, worker_id: str, lease_seconds: int = DEFAULT_LEASE_SECONDS
    ) -> bool:
        self.heartbeat_count += 1
        return self.heartbeat_result

    @override
    def mark_ready(
        self, *, job_id: str, worker_id: str, result: PreparationSummary
    ) -> bool:
        self.ready_result = result
        return True

    @override
    def mark_failed(
        self,
        *,
        job_id: str,
        worker_id: str,
        error: str,
        error_details: FailureDetails | None = None,
    ) -> bool:
        self.failed_error = error
        self.failed_error_details = error_details
        return True

    @override
    def snapshot(self, job_id: str) -> DurablePrepareJob | None:
        return self.snapshot_record
