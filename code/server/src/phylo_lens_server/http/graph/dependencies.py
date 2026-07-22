from __future__ import annotations

from functools import lru_cache

from phylo_lens_server.config import settings
from phylo_lens_server.repository.jobs.postgres import (
    DurablePrepareJobRegistry,
    PostgresPrepareJobStore,
)
from phylo_lens_server.repository.jobs.local import PrepareJobRegistry
from phylo_lens_server.repository.layout.postgres_layout_repository import (
    PostgresPreparedLayoutStore,
)
from phylo_lens_server.repository.layout.sqlite_layout_repository import (
    PreparedLayoutStore,
)
from phylo_lens_server.pipeline.worker import PreparedLayoutWorker


@lru_cache(maxsize=1)
def get_prepared_layout_store() -> PreparedLayoutStore | PostgresPreparedLayoutStore:
    if settings.prepare_job_backend() == settings.PREPARE_JOB_BACKEND_POSTGRES:
        return PostgresPreparedLayoutStore(settings.postgres_dsn())
    return PreparedLayoutStore(settings.prepared_layout_store_dir())


@lru_cache(maxsize=1)
def get_prepare_job_registry() -> PrepareJobRegistry | DurablePrepareJobRegistry:
    backend = settings.prepare_job_backend()
    if backend == settings.PREPARE_JOB_BACKEND_POSTGRES:
        return DurablePrepareJobRegistry(
            PostgresPrepareJobStore(settings.postgres_dsn()),
            max_active_jobs=settings.max_active_prepare_jobs(),
        )
    if backend != settings.PREPARE_JOB_BACKEND_LOCAL:
        raise ValueError(
            f"{settings.ENV_PREPARE_JOB_BACKEND} must be "
            f"'{settings.PREPARE_JOB_BACKEND_LOCAL}' or "
            f"'{settings.PREPARE_JOB_BACKEND_POSTGRES}'."
        )
    return PrepareJobRegistry(
        PreparedLayoutWorker(get_prepared_layout_store()),
        max_active_jobs=settings.max_active_prepare_jobs(),
    )


def shutdown_prepare_job_registry_if_started() -> None:
    if get_prepare_job_registry.cache_info().currsize == 0:
        return
    get_prepare_job_registry().shutdown()


DEFAULT_PREPARED_LAYOUT_STORE_DIR = settings.DEFAULT_PREPARED_LAYOUT_STORE_DIR
ENV_DATA_DIR = settings.ENV_DATA_DIR
ENV_MAX_ACTIVE_PREPARE_JOBS = settings.ENV_MAX_ACTIVE_PREPARE_JOBS
ENV_POSTGRES_DSN = settings.ENV_POSTGRES_DSN
ENV_PREPARE_JOB_BACKEND = settings.ENV_PREPARE_JOB_BACKEND
ENV_PREPARED_LAYOUT_STORE_DIR = settings.ENV_PREPARED_LAYOUT_STORE_DIR
PREPARE_JOB_BACKEND_LOCAL = settings.PREPARE_JOB_BACKEND_LOCAL
PREPARE_JOB_BACKEND_POSTGRES = settings.PREPARE_JOB_BACKEND_POSTGRES
PREPARED_LAYOUT_SUBDIR = settings.PREPARED_LAYOUT_SUBDIR
max_active_prepare_jobs = settings.max_active_prepare_jobs
postgres_dsn = settings.postgres_dsn
prepare_job_backend = settings.prepare_job_backend
prepared_layout_store_dir = settings.prepared_layout_store_dir
