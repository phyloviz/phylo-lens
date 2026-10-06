from __future__ import annotations

from functools import lru_cache

from phylo_lens_server.config import settings
from phylo_lens_server.jobs.durable import DurablePrepareJobRegistry
from phylo_lens_server.jobs.executor import PrepareExecutor
from phylo_lens_server.jobs.local import PrepareJobRegistry
from phylo_lens_server.jobs.models import PrepareJobs
from phylo_lens_server.repository.interfaces import LayoutRepository
from phylo_lens_server.repository.jobs.postgres import (
    PostgresPrepareJobStore,
)
from phylo_lens_server.repository.layout.postgres_layout_repository import (
    PostgresLayoutRepository,
)
from phylo_lens_server.repository.layout.sqlite_layout_repository import (
    SQLiteLayoutRepository,
)
from phylo_lens_server.services.preparation import PreparationService


@lru_cache(maxsize=1)
def get_prepared_layout_store() -> LayoutRepository:
    if settings.prepare_job_backend() == settings.PREPARE_JOB_BACKEND_POSTGRES:
        return PostgresLayoutRepository(settings.postgres_dsn())
    return SQLiteLayoutRepository(settings.prepared_layout_store_dir())


@lru_cache(maxsize=1)
def get_prepare_job_registry() -> PrepareJobs:
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
        PrepareExecutor(PreparationService(get_prepared_layout_store())),
        max_active_jobs=settings.max_active_prepare_jobs(),
    )


def shutdown_prepare_job_registry_if_started() -> None:
    if get_prepare_job_registry.cache_info().currsize == 0:
        return
    get_prepare_job_registry().shutdown()
