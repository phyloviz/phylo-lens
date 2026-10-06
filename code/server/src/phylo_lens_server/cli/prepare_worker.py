from __future__ import annotations

import logging
import os
import socket
import uuid

from phylo_lens_server.config.settings import (
    postgres_dsn,
)
from phylo_lens_server.jobs.worker import (
    run_postgres_prepare_worker,
    validate_poll_interval_seconds,
)
from phylo_lens_server.repository.jobs.postgres import (
    DEFAULT_LEASE_SECONDS,
    PostgresPrepareJobStore,
)
from phylo_lens_server.repository.layout.postgres_layout_repository import (
    PostgresLayoutRepository,
)
from phylo_lens_server.services.preparation import PreparationService

logger = logging.getLogger(__name__)

ENV_WORKER_ID = "PHYLO_LENS_WORKER_ID"
ENV_WORKER_MAX_JOBS = "PHYLO_LENS_WORKER_MAX_JOBS"
ENV_WORKER_POLL_INTERVAL_SECONDS = "PHYLO_LENS_WORKER_POLL_INTERVAL_SECONDS"
ENV_WORKER_LEASE_SECONDS = "PHYLO_LENS_WORKER_LEASE_SECONDS"
DEFAULT_WORKER_POLL_INTERVAL_SECONDS = 2.0
ERR_JOB_LEASE_LOST = "Prepare worker lost job ownership."


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    dsn = postgres_dsn()
    run_postgres_prepare_worker(
        job_store=PostgresPrepareJobStore(dsn),
        layout_worker=PreparationService(PostgresLayoutRepository(dsn)),
        worker_id=worker_id(),
        poll_interval_seconds=worker_poll_interval_seconds(),
        lease_seconds=worker_lease_seconds(),
        max_jobs=worker_max_jobs(),
    )


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


if __name__ == "__main__":
    main()
