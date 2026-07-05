from __future__ import annotations

from concurrent.futures import Future
from dataclasses import dataclass
import threading
from typing import Literal
import uuid

from phylo_lens_server.core.models import CanonicalDataset
from phylo_lens_server.prepared_layout.models import PreparedLayoutResult
from phylo_lens_server.prepared_layout.worker import PreparedLayoutWorker

PrepareJobStatus = Literal["pending", "ready", "failed"]

JOB_STATUS_PENDING: PrepareJobStatus = "pending"
JOB_STATUS_READY: PrepareJobStatus = "ready"
JOB_STATUS_FAILED: PrepareJobStatus = "failed"


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
    error: str | None = None
    warnings: tuple[str, ...] = ()


class PrepareJobRegistry:
    """Tracks background prepare jobs so callers can submit then poll.

    Prepare runs on the worker's single-threaded executor off the request
    thread, so ``/prepare`` returns immediately and clients poll for completion
    instead of holding an HTTP connection open for the full layout.
    """

    def __init__(self, worker: PreparedLayoutWorker) -> None:
        self._worker = worker
        self._lock = threading.Lock()
        self._futures: dict[str, Future[PreparedLayoutResult]] = {}
        self._warnings: dict[str, tuple[str, ...]] = {}

    def submit(
        self,
        dataset: CanonicalDataset,
        warnings: tuple[str, ...] = (),
    ) -> str:
        job_id = uuid.uuid4().hex
        future = self._worker.submit_prepare_dataset(dataset)
        with self._lock:
            self._futures[job_id] = future
            self._warnings[job_id] = warnings
        return job_id

    def snapshot(self, job_id: str) -> PrepareJobSnapshot | None:
        with self._lock:
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
