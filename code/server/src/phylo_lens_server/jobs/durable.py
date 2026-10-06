from contextlib import nullcontext

from phylo_lens_server.domain.models import Dataset
from phylo_lens_server.domain.sfdp import SfdpOptions
from phylo_lens_server.repository.jobs.postgres import (
    DURABLE_STATUS_QUEUED,
    DURABLE_STATUS_READY,
    DURABLE_STATUS_RUNNING,
    DurablePrepareJobStore,
    validate_max_active_jobs,
)

from .models import (
    JOB_STATUS_FAILED,
    JOB_STATUS_PENDING,
    JOB_STATUS_READY,
    PrepareJobSnapshot,
)


class DurablePrepareJobRegistry:
    """Route-facing adapter over a durable prepare-job store."""

    def __init__(
        self,
        store: DurablePrepareJobStore,
        *,
        max_active_jobs: int | None = None,
    ) -> None:
        validate_max_active_jobs(max_active_jobs)
        self._store = store
        self._max_active_jobs = max_active_jobs
        self._store.assert_schema_current()

    def reserve_capacity(self):
        # Durable admission remains atomic at submit time, after ingestion.
        return nullcontext(False)

    def submit(
        self,
        dataset: Dataset,
        warnings: tuple[str, ...] = (),
        *,
        sfdp_options: SfdpOptions | None = None,
        reserved_capacity: bool = False,
    ) -> str:
        return self._store.submit(
            dataset,
            warnings,
            sfdp_options=sfdp_options,
            max_active_jobs=self._max_active_jobs,
        )

    def snapshot(self, job_id: str) -> PrepareJobSnapshot | None:
        job = self._store.snapshot(job_id)
        if job is None:
            return None
        if job.status in (DURABLE_STATUS_QUEUED, DURABLE_STATUS_RUNNING):
            return PrepareJobSnapshot(
                job_id=job.job_id,
                status=JOB_STATUS_PENDING,
                warnings=job.warnings,
            )
        if job.status == DURABLE_STATUS_READY:
            return PrepareJobSnapshot(
                job_id=job.job_id,
                status=JOB_STATUS_READY,
                result=job.result,
                warnings=job.warnings,
            )
        return PrepareJobSnapshot(
            job_id=job.job_id,
            status=JOB_STATUS_FAILED,
            error=job.error or f"Prepare job ended with status '{job.status}'.",
            error_details=job.error_details,
            warnings=job.warnings,
        )

    def shutdown(self) -> None:
        pass
