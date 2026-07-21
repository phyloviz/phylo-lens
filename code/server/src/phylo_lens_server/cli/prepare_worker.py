from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
import logging
import os
import socket
import threading
import time
import uuid

from phylo_lens_server.config.settings import (
    ENV_POSTGRES_DSN,
    postgres_dsn,
)
from phylo_lens_server.repository.jobs.postgres import (
    DEFAULT_LEASE_SECONDS,
    DurablePrepareJobStore,
    PostgresPrepareJobStore,
)
from phylo_lens_server.repository.layout.postgres_layout_repository import (
    PostgresPreparedLayoutStore,
)
from phylo_lens_server.pipeline.worker import PreparedLayoutWorker
from phylo_lens_server.pipeline.worker import LayoutPublicationAbortedError
from phylo_lens_server.services.prepare_response import prepare_response_from_result

logger = logging.getLogger(__name__)

ENV_WORKER_ID = "PHYLO_LENS_WORKER_ID"
ENV_WORKER_MAX_JOBS = "PHYLO_LENS_WORKER_MAX_JOBS"
ENV_WORKER_POLL_INTERVAL_SECONDS = "PHYLO_LENS_WORKER_POLL_INTERVAL_SECONDS"
ENV_WORKER_LEASE_SECONDS = "PHYLO_LENS_WORKER_LEASE_SECONDS"
DEFAULT_WORKER_POLL_INTERVAL_SECONDS = 2.0
ERR_JOB_LEASE_LOST = "Prepare worker lost job ownership."


class PrepareJobLeaseLostError(RuntimeError):
    """Raised when a durable worker no longer owns the claimed job."""


@dataclass(frozen=True)
class LeaseMonitor:
    assert_owned: Callable[[], bool]
    stop: Callable[[], None]


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    dsn = postgres_dsn()
    run_postgres_prepare_worker(
        job_store=PostgresPrepareJobStore(dsn),
        layout_worker=PreparedLayoutWorker(PostgresPreparedLayoutStore(dsn)),
        worker_id=worker_id(),
        poll_interval_seconds=worker_poll_interval_seconds(),
        lease_seconds=worker_lease_seconds(),
        max_jobs=worker_max_jobs(),
    )


def run_postgres_prepare_worker(
    *,
    job_store: DurablePrepareJobStore,
    layout_worker: PreparedLayoutWorker,
    worker_id: str,
    poll_interval_seconds: float = DEFAULT_WORKER_POLL_INTERVAL_SECONDS,
    lease_seconds: int = DEFAULT_LEASE_SECONDS,
    max_jobs: int | None = None,
) -> None:
    """Continuously claim and execute durable prepare jobs."""
    validate_poll_interval_seconds(poll_interval_seconds)
    job_store.assert_schema_current()
    jobs_completed = 0
    try:
        while max_jobs is None or jobs_completed < max_jobs:
            claimed = job_store.claim_next(
                worker_id=worker_id,
                lease_seconds=lease_seconds,
            )
            if claimed is None:
                time.sleep(poll_interval_seconds)
                continue

            logger.info("prepare worker claimed job_id=%s", claimed.job_id)
            lease_monitor = start_heartbeat(
                job_store=job_store,
                job_id=claimed.job_id,
                worker_id=worker_id,
                lease_seconds=lease_seconds,
            )
            try:
                result = layout_worker.prepare_dataset(
                    claimed.dataset,
                    should_continue=lease_monitor.assert_owned,
                )
                response = prepare_response_from_result(
                    claimed.dataset.dataset_id,
                    result,
                    claimed.warnings,
                )
                marked = job_store.mark_ready(
                    job_id=claimed.job_id,
                    worker_id=worker_id,
                    result=response.model_dump(mode="json"),
                )
                if not marked:
                    raise PrepareJobLeaseLostError(ERR_JOB_LEASE_LOST)
                jobs_completed += 1
            except (PrepareJobLeaseLostError, LayoutPublicationAbortedError):
                logger.warning("prepare worker lost ownership job_id=%s", claimed.job_id)
                jobs_completed += 1
            except Exception as error:  # pragma: no cover - defensive worker loop
                logger.exception("prepare worker failed job_id=%s", claimed.job_id)
                job_store.mark_failed(
                    job_id=claimed.job_id,
                    worker_id=worker_id,
                    error=str(error) or type(error).__name__,
                )
                jobs_completed += 1
            finally:
                lease_monitor.stop()
    finally:
        layout_worker.shutdown()


def worker_id() -> str:
    configured = os.environ.get(ENV_WORKER_ID, "").strip()
    if configured:
        return configured
    return f"{socket.gethostname()}-{uuid.uuid4().hex[:8]}"


def worker_poll_interval_seconds() -> float:
    raw_value = os.environ.get(ENV_WORKER_POLL_INTERVAL_SECONDS, "").strip()
    if not raw_value:
        return DEFAULT_WORKER_POLL_INTERVAL_SECONDS
    value = float(raw_value)
    validate_poll_interval_seconds(value)
    return value


def worker_lease_seconds() -> int:
    raw_value = os.environ.get(ENV_WORKER_LEASE_SECONDS, "").strip()
    if not raw_value:
        return DEFAULT_LEASE_SECONDS
    value = int(raw_value)
    if value < 1:
        raise ValueError(f"{ENV_WORKER_LEASE_SECONDS} must be at least 1.")
    return value


def worker_max_jobs() -> int | None:
    raw_value = os.environ.get(ENV_WORKER_MAX_JOBS, "").strip()
    if not raw_value:
        return None
    value = int(raw_value)
    if value < 1:
        raise ValueError(f"{ENV_WORKER_MAX_JOBS} must be at least 1.")
    return value


def start_heartbeat(
    *,
    job_store: DurablePrepareJobStore,
    job_id: str,
    worker_id: str,
    lease_seconds: int,
) -> LeaseMonitor:
    interval_seconds = max(1.0, lease_seconds / 3.0)
    stopped = threading.Event()
    lost = threading.Event()

    def assert_owned() -> bool:
        if lost.is_set():
            return False
        renewed = job_store.heartbeat(
            job_id=job_id,
            worker_id=worker_id,
            lease_seconds=lease_seconds,
        )
        if not renewed:
            lost.set()
        return renewed

    def heartbeat_loop() -> None:
        while not stopped.wait(interval_seconds):
            if not assert_owned():
                logger.warning("prepare worker heartbeat lost job_id=%s", job_id)
                return

    thread = threading.Thread(
        target=heartbeat_loop,
        name=f"prepare-heartbeat-{job_id}",
        daemon=True,
    )
    thread.start()

    def stop() -> None:
        stopped.set()
        thread.join(timeout=interval_seconds)

    return LeaseMonitor(assert_owned=assert_owned, stop=stop)


def validate_poll_interval_seconds(value: float) -> None:
    if value <= 0:
        raise ValueError(f"{ENV_WORKER_POLL_INTERVAL_SECONDS} must be greater than 0.")


__all__ = [
    "ENV_POSTGRES_DSN",
    "ENV_WORKER_ID",
    "ENV_WORKER_LEASE_SECONDS",
    "ENV_WORKER_MAX_JOBS",
    "ENV_WORKER_POLL_INTERVAL_SECONDS",
    "run_postgres_prepare_worker",
]


if __name__ == "__main__":
    main()
