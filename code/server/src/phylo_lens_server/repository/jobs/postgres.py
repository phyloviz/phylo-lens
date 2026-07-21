from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
from typing import Any, Literal, Protocol
import uuid

from phylo_lens_server.database.schema_files import CREATE_SCHEMA_FILE, read_schema_sql
from phylo_lens_server.domain.models import CanonicalDataset
from phylo_lens_server.pipeline.ingest import layout_version_for_dataset
from phylo_lens_server.repository.jobs.local import (
    ERR_PREPARE_QUEUE_FULL,
    JOB_STATUS_FAILED,
    JOB_STATUS_PENDING,
    JOB_STATUS_READY,
    PrepareQueueFullError,
    PrepareJobSnapshot,
)

DurablePrepareJobStatus = Literal[
    "queued",
    "running",
    "ready",
    "failed",
    "cancelled",
]

DURABLE_STATUS_QUEUED: DurablePrepareJobStatus = "queued"
DURABLE_STATUS_RUNNING: DurablePrepareJobStatus = "running"
DURABLE_STATUS_READY: DurablePrepareJobStatus = "ready"
DURABLE_STATUS_FAILED: DurablePrepareJobStatus = "failed"
DURABLE_STATUS_CANCELLED: DurablePrepareJobStatus = "cancelled"

REUSABLE_DURABLE_STATUSES = (
    DURABLE_STATUS_QUEUED,
    DURABLE_STATUS_RUNNING,
    DURABLE_STATUS_READY,
)
ACTIVE_DURABLE_STATUSES = (
    DURABLE_STATUS_QUEUED,
    DURABLE_STATUS_RUNNING,
)

DEFAULT_LEASE_SECONDS = 300
ERR_DURABLE_JOB_INSERT_CONFLICT = "Prepare job insert conflicted unexpectedly."
POSTGRES_SCHEMA_FILE = CREATE_SCHEMA_FILE
POSTGRES_SUBMIT_ADVISORY_LOCK_KEY = (2_024_072_1, 11_031_337)
POSTGRES_SCHEMA_VERSION_TABLE = "phylo_lens_schema_version"
ERR_POSTGRES_SCHEMA_NOT_CURRENT = (
    "Postgres schema is not current. Run "
    "'phylo-lens-init-postgres' before starting API replicas or workers."
)


@dataclass(frozen=True)
class DurablePrepareJob:
    job_id: str
    dataset_id: str
    layout_version: str
    status: DurablePrepareJobStatus
    warnings: tuple[str, ...] = ()
    error: str | None = None
    result: dict[str, Any] | None = None
    worker_id: str | None = None


@dataclass(frozen=True)
class ClaimedPrepareJob:
    job_id: str
    dataset: CanonicalDataset
    warnings: tuple[str, ...]


@dataclass(frozen=True)
class PostgresSchema:
    version: str
    checksum: str
    sql: str


class DurablePrepareJobStore(Protocol):
    def create_schema(self) -> None: ...

    def assert_schema_current(self) -> None: ...

    def submit(
        self,
        dataset: CanonicalDataset,
        warnings: tuple[str, ...] = (),
        *,
        max_active_jobs: int | None = None,
    ) -> str: ...

    def claim_next(
        self,
        *,
        worker_id: str,
        lease_seconds: int = DEFAULT_LEASE_SECONDS,
    ) -> ClaimedPrepareJob | None: ...

    def heartbeat(
        self,
        *,
        job_id: str,
        worker_id: str,
        lease_seconds: int = DEFAULT_LEASE_SECONDS,
    ) -> bool: ...

    def mark_ready(
        self,
        *,
        job_id: str,
        worker_id: str,
        result: dict[str, Any],
    ) -> bool: ...

    def mark_failed(
        self,
        *,
        job_id: str,
        worker_id: str,
        error: str,
    ) -> bool: ...

    def snapshot(self, job_id: str) -> DurablePrepareJob | None: ...


class PostgresPrepareJobStore:
    """Postgres-backed durable prepare-job control plane."""

    def __init__(self, dsn: str) -> None:
        self._dsn = dsn

    def create_schema(self) -> None:
        with self._connect() as connection:
            with connection.transaction():
                _ensure_schema_version_table(connection)
                schema = postgres_schema()
                applied_checksum = _read_schema_checksum(connection, schema.version)
                if applied_checksum == schema.checksum:
                    return
                if applied_checksum is not None:
                    raise RuntimeError(
                        "Postgres schema checksum mismatch for "
                        f"{schema.version}."
                    )
                for statement in sql_statements(schema.sql):
                    connection.execute(statement)
                connection.execute(
                    f"""
                    insert into {POSTGRES_SCHEMA_VERSION_TABLE}(
                        version, checksum
                    ) values (%s, %s)
                    """,
                    (schema.version, schema.checksum),
                )

    def assert_schema_current(self) -> None:
        with self._connect() as connection:
            if not _schema_version_table_exists(connection):
                raise RuntimeError(ERR_POSTGRES_SCHEMA_NOT_CURRENT)
            schema = postgres_schema()
            applied_checksum = _read_schema_checksum(connection, schema.version)
            if applied_checksum != schema.checksum:
                raise RuntimeError(ERR_POSTGRES_SCHEMA_NOT_CURRENT)

    def submit(
        self,
        dataset: CanonicalDataset,
        warnings: tuple[str, ...] = (),
        *,
        max_active_jobs: int | None = None,
    ) -> str:
        validate_max_active_jobs(max_active_jobs)
        dataset_id = dataset.dataset_id
        layout_version = layout_version_for_dataset(dataset)
        payload = dataset.model_dump(mode="json")
        job_id = uuid.uuid4().hex

        with self._connect() as connection:
            with connection.transaction():
                _lock_prepare_submit(connection)
                reusable_job_id = _find_reusable_job_id(
                    connection,
                    dataset_id=dataset_id,
                    layout_version=layout_version,
                )
                if reusable_job_id is not None:
                    return reusable_job_id
                if _is_at_active_job_limit(connection, max_active_jobs):
                    raise PrepareQueueFullError(ERR_PREPARE_QUEUE_FULL)
                insert_cursor = connection.execute(
                    """
                    insert into prepare_jobs(
                        job_id, dataset_id, layout_version, status,
                        dataset_payload, warnings
                    )
                    values (%s, %s, %s, %s, %s::jsonb, %s::jsonb)
                    on conflict do nothing
                    returning job_id
                    """,
                    (
                        job_id,
                        dataset_id,
                        layout_version,
                        DURABLE_STATUS_QUEUED,
                        json.dumps(payload),
                        json.dumps(list(warnings)),
                    ),
                )
                inserted = insert_cursor.fetchone()
                if inserted is None:
                    reusable_after_race = _find_reusable_job_id(
                        connection,
                        dataset_id=dataset_id,
                        layout_version=layout_version,
                    )
                    if reusable_after_race is not None:
                        return reusable_after_race
                    raise RuntimeError(ERR_DURABLE_JOB_INSERT_CONFLICT)
        return job_id

    def claim_next(
        self,
        *,
        worker_id: str,
        lease_seconds: int = DEFAULT_LEASE_SECONDS,
    ) -> ClaimedPrepareJob | None:
        validate_lease_seconds(lease_seconds)
        with self._connect() as connection:
            with connection.transaction():
                row = connection.execute(
                    """
                    with candidate as (
                        select job_id
                        from prepare_jobs
                        where status = %s
                           or (
                                status = %s
                            and lease_expires_at is not null
                            and lease_expires_at < now()
                           )
                        order by created_at
                        for update skip locked
                        limit 1
                    )
                    update prepare_jobs
                    set status = %s,
                        worker_id = %s,
                        lease_expires_at = now() + (%s * interval '1 second')
                    where job_id in (select job_id from candidate)
                    returning job_id, dataset_payload, warnings
                    """,
                    (
                        DURABLE_STATUS_QUEUED,
                        DURABLE_STATUS_RUNNING,
                        DURABLE_STATUS_RUNNING,
                        worker_id,
                        lease_seconds,
                    ),
                ).fetchone()
        if row is None:
            return None
        return ClaimedPrepareJob(
            job_id=row["job_id"],
            dataset=CanonicalDataset.model_validate(row["dataset_payload"]),
            warnings=tuple(row["warnings"] or ()),
        )

    def heartbeat(
        self,
        *,
        job_id: str,
        worker_id: str,
        lease_seconds: int = DEFAULT_LEASE_SECONDS,
    ) -> bool:
        validate_lease_seconds(lease_seconds)
        with self._connect() as connection:
            row = connection.execute(
                """
                update prepare_jobs
                set lease_expires_at = now() + (%s * interval '1 second')
                where job_id = %s
                  and worker_id = %s
                  and status = %s
                returning job_id
                """,
                (lease_seconds, job_id, worker_id, DURABLE_STATUS_RUNNING),
            ).fetchone()
        return row is not None

    def mark_ready(
        self,
        *,
        job_id: str,
        worker_id: str,
        result: dict[str, Any],
    ) -> bool:
        with self._connect() as connection:
            row = connection.execute(
                """
                update prepare_jobs
                set status = %s,
                    result = %s::jsonb,
                    error = null,
                    lease_expires_at = null
                where job_id = %s
                  and worker_id = %s
                  and status = %s
                returning job_id
                """,
                (
                    DURABLE_STATUS_READY,
                    json.dumps(result),
                    job_id,
                    worker_id,
                    DURABLE_STATUS_RUNNING,
                ),
            ).fetchone()
        return row is not None

    def mark_failed(
        self,
        *,
        job_id: str,
        worker_id: str,
        error: str,
    ) -> bool:
        with self._connect() as connection:
            row = connection.execute(
                """
                update prepare_jobs
                set status = %s,
                    error = %s,
                    lease_expires_at = null
                where job_id = %s
                  and worker_id = %s
                  and status = %s
                returning job_id
                """,
                (
                    DURABLE_STATUS_FAILED,
                    error,
                    job_id,
                    worker_id,
                    DURABLE_STATUS_RUNNING,
                ),
            ).fetchone()
        return row is not None

    def snapshot(self, job_id: str) -> DurablePrepareJob | None:
        with self._connect() as connection:
            row = connection.execute(
                """
                select job_id, dataset_id, layout_version, status, warnings,
                       error, result, worker_id
                from prepare_jobs
                where job_id = %s
                """,
                (job_id,),
            ).fetchone()
        return None if row is None else durable_prepare_job_from_row(row)

    def _connect(self):
        psycopg = import_psycopg()
        return psycopg.connect(
            self._dsn,
            row_factory=psycopg.rows.dict_row,
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

    def submit(
        self,
        dataset: CanonicalDataset,
        warnings: tuple[str, ...] = (),
    ) -> str:
        return self._store.submit(
            dataset,
            warnings,
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
                result_payload=job.result,
                warnings=job.warnings,
            )
        return PrepareJobSnapshot(
            job_id=job.job_id,
            status=JOB_STATUS_FAILED,
            error=job.error or f"Prepare job ended with status '{job.status}'.",
            warnings=job.warnings,
        )

    def shutdown(self) -> None:
        pass


def durable_prepare_job_from_row(row: dict[str, Any]) -> DurablePrepareJob:
    return DurablePrepareJob(
        job_id=row["job_id"],
        dataset_id=row["dataset_id"],
        layout_version=row["layout_version"],
        status=row["status"],
        warnings=tuple(row["warnings"] or ()),
        error=row["error"],
        result=row["result"],
        worker_id=row["worker_id"],
    )


def validate_max_active_jobs(max_active_jobs: int | None) -> None:
    if max_active_jobs is not None and max_active_jobs < 1:
        raise ValueError("max_active_jobs must be at least 1 when set.")


def validate_lease_seconds(lease_seconds: int) -> None:
    if lease_seconds < 1:
        raise ValueError("lease_seconds must be at least 1.")


def _find_reusable_job_id(
    connection,
    *,
    dataset_id: str,
    layout_version: str,
) -> str | None:
    row = connection.execute(
        """
        select job_id
        from prepare_jobs
        where dataset_id = %s
          and layout_version = %s
          and status = any(%s)
        order by created_at
        limit 1
        """,
        (dataset_id, layout_version, list(REUSABLE_DURABLE_STATUSES)),
    ).fetchone()
    return None if row is None else row["job_id"]


def _lock_prepare_submit(connection) -> None:
    connection.execute(
        "select pg_advisory_xact_lock(%s, %s)",
        POSTGRES_SUBMIT_ADVISORY_LOCK_KEY,
    )


def _is_at_active_job_limit(connection, max_active_jobs: int | None) -> bool:
    if max_active_jobs is None:
        return False
    row = connection.execute(
        """
        select count(*) as active_count
        from prepare_jobs
        where status = any(%s)
        """,
        (list(ACTIVE_DURABLE_STATUSES),),
    ).fetchone()
    return row["active_count"] >= max_active_jobs


def import_psycopg():
    try:
        import psycopg
        import psycopg.rows
    except ImportError as error:  # pragma: no cover - depends on optional extra
        raise RuntimeError(
            "Postgres prepare jobs require the 'postgres' extra: "
            "pip install 'phylo-lens-server[postgres]'."
        ) from error
    return psycopg


POSTGRES_CREATE_SCHEMA_SQL = read_schema_sql("postgres")


def postgres_create_schema_statements() -> tuple[str, ...]:
    return sql_statements(POSTGRES_CREATE_SCHEMA_SQL)


def postgres_schema() -> PostgresSchema:
    return PostgresSchema(
        version=POSTGRES_SCHEMA_FILE,
        checksum=hashlib.sha256(POSTGRES_CREATE_SCHEMA_SQL.encode("utf-8")).hexdigest(),
        sql=POSTGRES_CREATE_SCHEMA_SQL,
    )


def sql_statements(sql: str) -> tuple[str, ...]:
    statements: list[str] = []
    start = 0
    index = 0
    in_dollar_quote = False
    while index < len(sql):
        if sql.startswith("$$", index):
            in_dollar_quote = not in_dollar_quote
            index += 2
            continue
        if sql[index] == ";" and not in_dollar_quote:
            statement = sql[start:index].strip()
            if statement:
                statements.append(statement)
            start = index + 1
        index += 1

    tail = sql[start:].strip()
    if tail:
        statements.append(tail)
    return tuple(statements)


def _ensure_schema_version_table(connection) -> None:
    connection.execute(
        f"""
        create table if not exists {POSTGRES_SCHEMA_VERSION_TABLE}(
            version text primary key,
            checksum text not null,
            applied_at timestamptz not null default now()
        )
        """
    )


def _schema_version_table_exists(connection) -> bool:
    row = connection.execute(
        "select to_regclass(%s) as schema_version_table",
        (POSTGRES_SCHEMA_VERSION_TABLE,),
    ).fetchone()
    return row is not None and row["schema_version_table"] is not None


def _read_schema_checksum(connection, version: str) -> str | None:
    row = connection.execute(
        f"select checksum from {POSTGRES_SCHEMA_VERSION_TABLE} where version = %s",
        (version,),
    ).fetchone()
    return None if row is None else row["checksum"]
