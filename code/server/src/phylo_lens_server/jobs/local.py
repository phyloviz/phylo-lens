from __future__ import annotations

import threading
import uuid
from collections.abc import Generator
from concurrent.futures import Future
from contextlib import contextmanager

from phylo_lens_server.domain.identity import layout_version_for_dataset
from phylo_lens_server.domain.models import Dataset
from phylo_lens_server.domain.preparation import (
    PreparationSummary,
    PreparedLayoutResult,
)
from phylo_lens_server.domain.sfdp import SfdpOptions

from .failures import error_details, error_message
from .models import (
    ERR_JOB_CANCELLED,
    ERR_PREPARE_QUEUE_FULL,
    JOB_STATUS_FAILED,
    JOB_STATUS_PENDING,
    JOB_STATUS_READY,
    PrepareJobSnapshot,
    PrepareQueueFullError,
    PrepareWorker,
)

PrepareLayoutKey = tuple[str, str]


class PrepareJobRegistry:
    """Tracks background prepare jobs so callers can submit then poll.

    Prepare runs on the worker's single-threaded executor off the request
    thread, so ``/prepare`` returns immediately and clients poll for completion
    instead of holding an HTTP connection open for the full layout.
    """

    def __init__(
        self,
        worker: PrepareWorker,
        *,
        max_active_jobs: int | None = None,
    ) -> None:
        if max_active_jobs is not None and max_active_jobs < 1:
            raise ValueError("max_active_jobs must be at least 1 when set.")
        self._worker = worker
        self._max_active_jobs = max_active_jobs
        self._lock = threading.Lock()
        self._futures: dict[str, Future[PreparedLayoutResult]] = {}
        self._completed_jobs: dict[str, PrepareJobSnapshot] = {}
        self._warnings: dict[str, tuple[str, ...]] = {}
        self._job_ids_by_layout_key: dict[PrepareLayoutKey, str] = {}
        self._active_reservations = 0

    def submit(
        self,
        dataset: Dataset,
        warnings: tuple[str, ...] = (),
        *,
        sfdp_options: SfdpOptions | None = None,
        reserved_capacity: bool = False,
    ) -> str:
        layout_key = prepare_layout_key(dataset, sfdp_options)
        with self._lock:
            reusable_job_id = self._reusable_job_id_locked(layout_key)
            if reusable_job_id is not None:
                return reusable_job_id
            if not reserved_capacity and self._is_at_active_job_limit_locked():
                raise PrepareQueueFullError(ERR_PREPARE_QUEUE_FULL)

            job_id = uuid.uuid4().hex
            future = self._worker.submit_prepare_dataset(
                dataset,
                sfdp_options=sfdp_options,
            )
            self._futures[job_id] = future
            self._warnings[job_id] = warnings
            self._job_ids_by_layout_key[layout_key] = job_id

        future.add_done_callback(
            lambda completed, completed_job_id=job_id, completed_layout_key=layout_key: (
                self._record_completed_job(
                    completed_job_id,
                    completed_layout_key,
                    completed,
                )
            )
        )
        return job_id

    @contextmanager
    def reserve_capacity(self) -> Generator[bool]:
        with self._lock:
            if self._is_at_active_job_limit_locked():
                raise PrepareQueueFullError(ERR_PREPARE_QUEUE_FULL)
            self._active_reservations += 1
        try:
            yield True
        finally:
            with self._lock:
                self._active_reservations -= 1

    def snapshot(self, job_id: str) -> PrepareJobSnapshot | None:
        with self._lock:
            completed = self._completed_jobs.get(job_id)
            if completed is not None:
                return completed
            future = self._futures.get(job_id)
            warnings = self._warnings.get(job_id, ())
        if future is None:
            return None
        if not future.done():
            return PrepareJobSnapshot(
                job_id=job_id,
                status=JOB_STATUS_PENDING,
                warnings=warnings,
            )
        return completed_snapshot(job_id, future, warnings)

    def shutdown(self) -> None:
        self._worker.shutdown()

    def _reusable_job_id_locked(self, layout_key: PrepareLayoutKey) -> str | None:
        job_id = self._job_ids_by_layout_key.get(layout_key)
        if job_id is None:
            return None
        future = self._futures.get(job_id)
        if future is None:
            completed = self._completed_jobs.get(job_id)
            if completed is not None and completed.status == JOB_STATUS_READY:
                return job_id
            self._job_ids_by_layout_key.pop(layout_key, None)
            return None
        if is_reusable_future(future):
            return job_id

        self._job_ids_by_layout_key.pop(layout_key, None)
        return None

    def _is_at_active_job_limit_locked(self) -> bool:
        if self._max_active_jobs is None:
            return False
        active_jobs = sum(1 for future in self._futures.values() if not future.done())
        active_jobs += self._active_reservations
        return active_jobs >= self._max_active_jobs

    def _record_completed_job(
        self,
        job_id: str,
        layout_key: PrepareLayoutKey,
        future: Future[PreparedLayoutResult],
    ) -> None:
        with self._lock:
            warnings = self._warnings.get(job_id, ())

        snapshot = completed_snapshot(job_id, future, warnings)

        with self._lock:
            self._futures.pop(job_id, None)
            self._warnings.pop(job_id, None)
            self._completed_jobs[job_id] = snapshot
            if snapshot.status != JOB_STATUS_READY:
                self._job_ids_by_layout_key.pop(layout_key, None)


def prepare_layout_key(
    dataset: Dataset,
    sfdp_options: SfdpOptions | None = None,
) -> PrepareLayoutKey:
    return (dataset.dataset_id, layout_version_for_dataset(dataset, sfdp_options))


def is_reusable_future(future: Future[PreparedLayoutResult]) -> bool:
    if not future.done():
        return True
    if future.cancelled():
        return False
    return future.exception() is None


def completed_snapshot(
    job_id: str, future: Future[PreparedLayoutResult], warnings: tuple[str, ...]
) -> PrepareJobSnapshot:
    if future.cancelled():
        return PrepareJobSnapshot(
            job_id, JOB_STATUS_FAILED, error=ERR_JOB_CANCELLED, warnings=warnings
        )
    error = future.exception()
    if error is not None:
        return PrepareJobSnapshot(
            job_id,
            JOB_STATUS_FAILED,
            error=error_message(error),
            error_details=error_details(error),
            warnings=warnings,
        )
    return PrepareJobSnapshot(
        job_id,
        JOB_STATUS_READY,
        result=PreparationSummary.from_result(future.result(), warnings),
        warnings=warnings,
    )
