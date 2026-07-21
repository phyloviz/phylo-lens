from __future__ import annotations

from typing import Any

import pytest

from phylo_lens_server.database import schema_files
from phylo_lens_server.database.schema_files import schema_file_path
from phylo_lens_server.data.normalizer import NormalizeRequest, normalize_dataset
from phylo_lens_server.repository.jobs import postgres as job_store


def test_durable_prepare_job_from_row_normalizes_json_fields() -> None:
    record = job_store.durable_prepare_job_from_row(
        {
            "job_id": "job-1",
            "dataset_id": "dataset-1",
            "layout_version": "layout-1",
            "status": "ready",
            "warnings": ["slow layout"],
            "error": None,
            "result": {"layout_status": "ready"},
            "worker_id": "worker-1",
        }
    )

    assert record.job_id == "job-1"
    assert record.status == "ready"
    assert record.warnings == ("slow layout",)
    assert record.result == {"layout_status": "ready"}
    assert record.worker_id == "worker-1"


def test_validate_max_active_jobs_rejects_non_positive_values() -> None:
    job_store.validate_max_active_jobs(None)
    job_store.validate_max_active_jobs(1)

    with pytest.raises(ValueError):
        job_store.validate_max_active_jobs(0)


def test_validate_lease_seconds_rejects_non_positive_values() -> None:
    job_store.validate_lease_seconds(1)

    with pytest.raises(ValueError):
        job_store.validate_lease_seconds(0)


def test_postgres_schema_defines_durable_job_controls() -> None:
    schema = job_store.POSTGRES_CREATE_SCHEMA_SQL
    statements = job_store.postgres_create_schema_statements()

    assert schema == schema_file_path("postgres").read_text(encoding="utf-8")
    assert "create table if not exists prepare_jobs" in schema
    assert "lease_expires_at" in schema
    assert "phylo_lens_touch_prepare_jobs_updated_at" in schema
    assert "idx_prepare_jobs_reusable_layout" in schema
    assert "where status in ('queued', 'running', 'ready')" in schema
    assert "create table if not exists node_positions" in schema
    assert "create table if not exists prepared_edges" in schema
    assert "trg_datasets_touch_updated_at" in schema
    assert len(statements) >= 8
    assert all(not statement.endswith(";") for statement in statements)


def test_schema_roots_include_installed_target_layout() -> None:
    roots = schema_files.schema_roots()

    assert roots[1] == schema_files.Path(schema_files.__file__).resolve().parents[2] / "sql"


def test_postgres_claim_query_uses_skip_locked() -> None:
    source = job_store.PostgresPrepareJobStore.claim_next.__code__.co_consts

    assert any("for update skip locked" in str(constant) for constant in source)


def test_postgres_submit_serializes_active_limit_check_with_advisory_lock() -> None:
    source = job_store.PostgresPrepareJobStore.submit.__code__.co_names
    lock_source = job_store._lock_prepare_submit.__code__.co_consts

    assert "_lock_prepare_submit" in source
    assert any("pg_advisory_xact_lock" in str(constant) for constant in lock_source)


class RecordingDurableStore:
    def __init__(self, snapshot) -> None:
        self.snapshot_record = snapshot
        self.schema_asserted = False
        self.submitted: list[tuple[str, tuple[str, ...], int | None]] = []

    def create_schema(self) -> None:
        raise NotImplementedError

    def assert_schema_current(self) -> None:
        self.schema_asserted = True

    def submit(self, dataset, warnings=(), *, max_active_jobs=None) -> str:
        self.submitted.append((dataset.dataset_id, warnings, max_active_jobs))
        return "job-1"

    def claim_next(self, *, worker_id: str, lease_seconds: int):
        return None

    def heartbeat(self, *, job_id: str, worker_id: str, lease_seconds: int) -> bool:
        return True

    def mark_ready(
        self,
        *,
        job_id: str,
        worker_id: str,
        result: dict[str, Any],
    ) -> bool:
        return True

    def mark_failed(self, *, job_id: str, worker_id: str, error: str) -> bool:
        return True

    def snapshot(self, job_id: str):
        return self.snapshot_record


def test_durable_prepare_job_registry_submits_and_maps_ready_snapshot() -> None:
    dataset = normalize_dataset(
        NormalizeRequest(
            format="newick",
            dataset_name="durable-tree",
            content="(a:1,b:1)root;",
        )
    ).dataset
    result_payload = {
        "dataset_id": "durable-tree",
        "layout_version": "abc",
        "node_count": 3,
        "edge_count": 2,
        "cluster_count": 1,
        "lod_tier_count": 1,
        "layout_status": "ready",
        "warnings": ["note"],
    }
    store = RecordingDurableStore(
        job_store.DurablePrepareJob(
            job_id="job-1",
            dataset_id="durable-tree",
            layout_version="abc",
            status="ready",
            warnings=("note",),
            result=result_payload,
        )
    )
    registry = job_store.DurablePrepareJobRegistry(store, max_active_jobs=2)

    job_id = registry.submit(dataset, ("note",))
    snapshot = registry.snapshot(job_id)

    assert store.schema_asserted is True
    assert store.submitted == [("durable-tree", ("note",), 2)]
    assert snapshot is not None
    assert snapshot.status == "ready"
    assert snapshot.result_payload == result_payload


def test_postgres_schema_is_checksummed() -> None:
    schema = job_store.postgres_schema()

    assert schema.version == job_store.POSTGRES_SCHEMA_FILE
    assert len(schema.checksum) == 64
    assert schema.sql == job_store.POSTGRES_CREATE_SCHEMA_SQL


def test_postgres_schema_assertion_does_not_run_ddl() -> None:
    source = job_store.PostgresPrepareJobStore.assert_schema_current.__code__.co_consts
    names = job_store.PostgresPrepareJobStore.assert_schema_current.__code__.co_names

    assert not any("create table" in str(constant).lower() for constant in source)
    assert "_schema_version_table_exists" in names
