from __future__ import annotations

from functools import lru_cache

from phylo_lens_server.config import settings
from phylo_lens_server.pipeline.worker import PreparedLayoutWorker
from phylo_lens_server.repository.jobs.local import PrepareJobRegistry
from phylo_lens_server.repository.jobs.postgres import (
    DurablePrepareJobRegistry,
    PostgresPrepareJobStore,
)
from phylo_lens_server.repository.layout.postgres_layout_repository import (
    PostgresPreparedLayoutStore,
)
from phylo_lens_server.repository.layout.sqlite_layout_repository import (
    PreparedLayoutStore,
)


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
