from __future__ import annotations

from concurrent.futures import Future
from contextlib import contextmanager
from dataclasses import dataclass
from collections.abc import Generator
import threading
from typing import Any, Literal, Protocol
import uuid

from phylo_lens_server.domain.models import CanonicalDataset
from phylo_lens_server.pipeline.ingest import layout_version_for_dataset
from phylo_lens_server.pipeline.models import PreparedLayoutResult
from phylo_lens_server.repository.jobs.result_payload import prepare_result_payload

PrepareJobStatus = Literal["pending", "ready", "failed"]

JOB_STATUS_PENDING: PrepareJobStatus = "pending"
JOB_STATUS_READY: PrepareJobStatus = "ready"
JOB_STATUS_FAILED: PrepareJobStatus = "failed"

ERR_JOB_CANCELLED = "Layout preparation was cancelled."
ERR_PREPARE_QUEUE_FULL = "Too many graph prepare jobs are already queued or running."

PrepareLayoutKey = tuple[str, str]


class PrepareQueueFullError(RuntimeError):
    """Raised when a new prepare job would exceed the registry's active limit."""


class PrepareWorker(Protocol):
    def submit_prepare_dataset(
        self,
        dataset: CanonicalDataset,
    ) -> Future[PreparedLayoutResult]: ...

    def shutdown(self) -> None: ...


@dataclass(frozen=True)
class PrepareJobSnapshot:
    """Immutable view of a prepare job's current state.

    Exactly one of ``result`` (when ``status == "ready"``) or ``error`` (when
    ``status == "failed"``) is populated; both are ``None`` while pending.
    ``warnings`` carries the normalize/distance warnings captured at submit time
    so the ready response can combine them with layout warnings.
    """

    job_id: str
    status: PrepareJobStatus
    result: PreparedLayoutResult | None = None
    result_payload: dict[str, Any] | None = None
    error: str | None = None
    warnings: tuple[str, ...] = ()


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
        dataset: CanonicalDataset,
        warnings: tuple[str, ...] = (),
        *,
        reserved_capacity: bool = False,
    ) -> str:
        layout_key = prepare_layout_key(dataset)
        with self._lock:
            reusable_job_id = self._reusable_job_id_locked(layout_key)
            if reusable_job_id is not None:
                return reusable_job_id
            if not reserved_capacity and self._is_at_active_job_limit_locked():
                raise PrepareQueueFullError(ERR_PREPARE_QUEUE_FULL)

            job_id = uuid.uuid4().hex
            future = self._worker.submit_prepare_dataset(dataset)
            self._futures[job_id] = future
            self._warnings[job_id] = warnings
            self._job_ids_by_layout_key[layout_key] = job_id

        future.add_done_callback(
            lambda completed, completed_job_id=job_id, completed_layout_key=layout_key: self._record_completed_job(
                completed_job_id,
                completed_layout_key,
                completed,
            )
        )
        return job_id

    @contextmanager
    def reserve_capacity(self) -> Generator[None]:
        with self._lock:
            if self._is_at_active_job_limit_locked():
                raise PrepareQueueFullError(ERR_PREPARE_QUEUE_FULL)
            self._active_reservations += 1
        try:
            yield
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
        if future.cancelled():
            return PrepareJobSnapshot(
                job_id=job_id,
                status=JOB_STATUS_FAILED,
                error=ERR_JOB_CANCELLED,
                warnings=warnings,
            )
        error = future.exception()
        if error is not None:
            return PrepareJobSnapshot(
                job_id=job_id,
                status=JOB_STATUS_FAILED,
                error=str(error) or type(error).__name__,
                warnings=warnings,
            )
        return PrepareJobSnapshot(
            job_id=job_id,
            status=JOB_STATUS_READY,
            result=future.result(),
            warnings=warnings,
        )

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

        snapshot: PrepareJobSnapshot
        if future.cancelled():
            snapshot = PrepareJobSnapshot(
                job_id=job_id,
                status=JOB_STATUS_FAILED,
                error=ERR_JOB_CANCELLED,
                warnings=warnings,
            )
        else:
            error = future.exception()
            if error is not None:
                snapshot = PrepareJobSnapshot(
                    job_id=job_id,
                    status=JOB_STATUS_FAILED,
                    error=str(error) or type(error).__name__,
                    warnings=warnings,
                )
            else:
                result = future.result()
                snapshot = PrepareJobSnapshot(
                    job_id=job_id,
                    status=JOB_STATUS_READY,
                    result_payload=prepare_result_payload(result, warnings),
                    warnings=warnings,
                )

        with self._lock:
            self._futures.pop(job_id, None)
            self._warnings.pop(job_id, None)
            self._completed_jobs[job_id] = snapshot
            if snapshot.status != JOB_STATUS_READY:
                self._job_ids_by_layout_key.pop(layout_key, None)


def prepare_layout_key(dataset: CanonicalDataset) -> PrepareLayoutKey:
    return (dataset.dataset_id, layout_version_for_dataset(dataset))


def is_reusable_future(future: Future[PreparedLayoutResult]) -> bool:
    if not future.done():
        return True
    if future.cancelled():
        return False
    return future.exception() is None
