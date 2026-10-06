from __future__ import annotations

import json
import uuid
from dataclasses import dataclass, field
from typing import Literal, Protocol

from phylo_lens_server.database import postgres
from phylo_lens_server.domain.ancillary import AncillaryField
from phylo_lens_server.domain.identity import layout_version_for_dataset
from phylo_lens_server.domain.legacy_metadata import (
    decode_node_annotations,
    is_summary_key,
)
from phylo_lens_server.domain.models import Dataset
from phylo_lens_server.domain.preparation import PreparationSummary
from phylo_lens_server.domain.sfdp import SfdpOptions, resolve_sfdp_options
from phylo_lens_server.jobs.models import (
    ERR_PREPARE_QUEUE_FULL,
    FailureDetails,
    PrepareQueueFullError,
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
POSTGRES_SUBMIT_ADVISORY_LOCK_KEY = (2_024_072_1, 11_031_337)


@dataclass(frozen=True)
class DurablePrepareJob:
    job_id: str
    dataset_id: str
    layout_version: str
    status: DurablePrepareJobStatus
    warnings: tuple[str, ...] = ()
    error: str | None = None
    error_details: FailureDetails | None = None
    result: PreparationSummary | None = None
    worker_id: str | None = None


@dataclass(frozen=True)
class ClaimedPrepareJob:
    job_id: str
    dataset: Dataset
    warnings: tuple[str, ...]
    sfdp_options: SfdpOptions = field(default_factory=SfdpOptions)


class DurablePrepareJobStore(Protocol):
    def create_schema(self) -> None: ...

    def assert_schema_current(self) -> None: ...

    def submit(
        self,
        dataset: Dataset,
        warnings: tuple[str, ...] = (),
        *,
        sfdp_options: SfdpOptions | None = None,
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
        result: PreparationSummary,
    ) -> bool: ...

    def mark_failed(
        self,
        *,
        job_id: str,
        worker_id: str,
        error: str,
        error_details: FailureDetails | None = None,
    ) -> bool: ...

    def snapshot(self, job_id: str) -> DurablePrepareJob | None: ...


class PostgresPrepareJobStore:
    """Postgres-backed durable prepare-job control plane."""

    def __init__(self, dsn: str) -> None:
        self._dsn = dsn

    def create_schema(self) -> None:
        postgres.create_schema(self._dsn)

    def assert_schema_current(self) -> None:
        postgres.assert_schema_current(self._dsn)

    def submit(
        self,
        dataset: Dataset,
        warnings: tuple[str, ...] = (),
        *,
        sfdp_options: SfdpOptions | None = None,
        max_active_jobs: int | None = None,
    ) -> str:
        validate_max_active_jobs(max_active_jobs)
        dataset_id = dataset.dataset_id
        resolved_sfdp_options = resolve_sfdp_options(sfdp_options)
        layout_version = layout_version_for_dataset(dataset, resolved_sfdp_options)
        payload = {
            "dataset": dataset.model_dump(mode="json"),
            "sfdp_options": resolved_sfdp_options.model_dump(
                mode="json",
                by_alias=True,
            ),
        }
        job_id = uuid.uuid4().hex

        with self._connect() as connection, connection.transaction():
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
        with self._connect() as connection, connection.transaction():
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
            dataset=decode_dataset_payload(
                row["dataset_payload"].get("dataset", row["dataset_payload"])
            ),
            warnings=tuple(row["warnings"] or ()),
            sfdp_options=SfdpOptions.model_validate(
                row["dataset_payload"].get("sfdp_options", {})
            ),
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
        result: PreparationSummary,
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
                    result.model_dump_json(),
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
        error_details: FailureDetails | None = None,
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
                    serialize_failure(error, error_details),
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
        return postgres.connect(self._dsn)


def durable_prepare_job_from_row(row: dict[str, object]) -> DurablePrepareJob:
    error, error_details = deserialize_failure(row["error"])
    return DurablePrepareJob(
        job_id=row["job_id"],
        dataset_id=row["dataset_id"],
        layout_version=row["layout_version"],
        status=row["status"],
        warnings=tuple(row["warnings"] or ()),
        error=error,
        error_details=error_details,
        result=PreparationSummary.model_validate(row["result"])
        if row["result"] is not None
        else None,
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


def serialize_failure(error: str, details: FailureDetails | None) -> str:
    """Persist structured diagnostics in legacy text-only durable job storage."""
    if details is None:
        return error
    return json.dumps({"message": error, "details": dict(details)}, sort_keys=True)


def deserialize_failure(error: str | None) -> tuple[str | None, FailureDetails | None]:
    if not error:
        return error, None
    try:
        payload = json.loads(error)
    except json.JSONDecodeError:
        return error, None
    if not isinstance(payload, dict) or not isinstance(payload.get("message"), str):
        return error, None
    details = payload.get("details")
    return payload["message"], details if isinstance(details, dict) else None


def decode_dataset_payload(payload: dict[str, object]) -> Dataset:
    """Accept historical durable dataset JSON without supporting old Python constructors."""
    values = dict(payload)
    if "metadata_by_node_id" in values:
        if "annotations_by_node_id" in values:
            raise ValueError(
                "Supply annotations_by_node_id or legacy metadata_by_node_id, not both."
            )
        values["annotations_by_node_id"] = {
            key: decode_node_annotations(value)
            for key, value in values.pop("metadata_by_node_id").items()
        }
    if "metadata_schema" in values:
        if "ancillary_schema" in values or "summary_schema" in values:
            raise ValueError(
                "Supply ancillary_schema or legacy metadata_schema, not both."
            )
        fields = tuple(
            AncillaryField.model_validate(value)
            for value in values.pop("metadata_schema")
        )
        values["ancillary_schema"] = tuple(
            field for field in fields if not is_summary_key(field.key)
        )
        values["summary_schema"] = tuple(
            field for field in fields if is_summary_key(field.key)
        )
    if "isolates_by_node_id" in values:
        values["isolates_by_node_id"] = {
            key: [
                (
                    {
                        **{
                            name: value
                            for name, value in isolate.items()
                            if name != "metadata"
                        },
                        "ancillary_data": isolate["metadata"],
                    }
                    if "metadata" in isolate
                    else isolate
                )
                for isolate in isolates
            ]
            for key, isolates in values["isolates_by_node_id"].items()
        }
    return Dataset.model_validate(values)
