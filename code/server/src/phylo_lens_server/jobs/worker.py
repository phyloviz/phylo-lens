"""Durable execution, lease ownership and heartbeat lifecycle."""

import logging
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass

from phylo_lens_server.domain.preparation import PreparationSummary
from phylo_lens_server.repository.jobs.postgres import (
    DEFAULT_LEASE_SECONDS,
    DurablePrepareJobStore,
)
from phylo_lens_server.services.preparation import PreparationService

from .failures import error_details, error_message
from .models import LayoutPublicationAbortedError

logger = logging.getLogger(__name__)
DEFAULT_WORKER_POLL_INTERVAL_SECONDS = 2.0
ERR_JOB_LEASE_LOST = "Prepare worker lost job ownership."
ENV_WORKER_POLL_INTERVAL_SECONDS = "PHYLO_LENS_WORKER_POLL_INTERVAL_SECONDS"


class PrepareJobLeaseLostError(RuntimeError):
    """Raised when a durable worker no longer owns the claimed job."""


@dataclass(frozen=True)
class LeaseMonitor:
    assert_owned: Callable[[], bool]
    stop: Callable[[], None]


def run_postgres_prepare_worker(
    *,
    job_store: DurablePrepareJobStore,
    layout_worker: PreparationService,
    worker_id: str,
    poll_interval_seconds: float = DEFAULT_WORKER_POLL_INTERVAL_SECONDS,
    lease_seconds: int = DEFAULT_LEASE_SECONDS,
    max_jobs: int | None = None,
) -> None:
    """Continuously claim and execute durable prepare jobs."""
    validate_poll_interval_seconds(poll_interval_seconds)
    job_store.assert_schema_current()
    jobs_completed = 0
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
                sfdp_options=claimed.sfdp_options,
                should_continue=lease_monitor.assert_owned,
            )
            summary = PreparationSummary.from_result(result, claimed.warnings)
            marked = job_store.mark_ready(
                job_id=claimed.job_id,
                worker_id=worker_id,
                result=summary,
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
                error=error_message(error),
                error_details=error_details(error),
            )
            jobs_completed += 1
        finally:
            lease_monitor.stop()


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
