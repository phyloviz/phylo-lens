from __future__ import annotations

import pytest

from phylo_lens_server.database import postgres, schema_files
from phylo_lens_server.database.schema_files import schema_file_path
from phylo_lens_server.domain.preparation import PreparationSummary
from phylo_lens_server.http.graph.schemas import NormalizeRequest
from phylo_lens_server.jobs.durable import DurablePrepareJobRegistry
from phylo_lens_server.pipeline.ingestion import ingest_dataset
from phylo_lens_server.repository.jobs import postgres as job_store
from tests.support.durable_store import RecordingDurableStore


def test_durable_prepare_job_from_row_normalizes_json_fields() -> None:
    record = job_store.durable_prepare_job_from_row(
        {
            "job_id": "job-1",
            "dataset_id": "dataset-1",
            "layout_version": "layout-1",
            "status": "ready",
            "warnings": ["slow layout"],
            "error": None,
            "result": {
                "dataset_id": "dataset-1",
                "layout_version": "layout-1",
                "node_count": 3,
                "edge_count": 2,
                "cluster_count": 1,
                "layout_status": "ready",
            },
            "worker_id": "worker-1",
        }
    )

    assert record.job_id == "job-1"
    assert record.status == "ready"
    assert record.warnings == ("slow layout",)
    assert record.result.layout_status == "ready"
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
    schema = postgres.POSTGRES_CREATE_SCHEMA_SQL
    statements = postgres.sql_statements(postgres.POSTGRES_CREATE_SCHEMA_SQL)

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

    assert (
        roots[1]
        == schema_files.Path(schema_files.__file__).resolve().parents[2] / "sql"
    )


def test_durable_prepare_job_registry_submits_and_maps_ready_snapshot() -> None:
    dataset = ingest_dataset(
        NormalizeRequest(
            format="newick",
            dataset_name="durable-tree",
            content="(a:1,b:1)root;",
        ).to_domain()
    ).dataset
    result_payload = {
        "dataset_id": "durable-tree",
        "layout_version": "abc",
        "node_count": 3,
        "edge_count": 2,
        "cluster_count": 1,
        "lod_tier_count": 1,
        "technical_roots": ["root"],
        "layout_status": "ready",
        "warnings": ["note"],
    }
    store = RecordingDurableStore(
        snapshot_record=job_store.DurablePrepareJob(
            job_id="job-1",
            dataset_id="durable-tree",
            layout_version="abc",
            status="ready",
            warnings=("note",),
            result=PreparationSummary.model_validate(result_payload),
        ),
        submit_result="job-1",
    )
    registry = DurablePrepareJobRegistry(store, max_active_jobs=2)

    job_id = registry.submit(dataset, ("note",))
    snapshot = registry.snapshot(job_id)

    assert store.schema_asserted is True
    assert store.submitted == [("durable-tree", ("note",), 2)]
    assert snapshot is not None
    assert snapshot.status == "ready"
    assert snapshot.result.model_dump(mode="json", exclude_none=True) == result_payload


def test_postgres_schema_is_checksummed() -> None:
    schema = postgres.postgres_schema()

    assert schema.version == postgres.POSTGRES_SCHEMA_VERSION
    assert len(schema.checksum) == 64
    assert schema.sql == postgres.POSTGRES_CREATE_SCHEMA_SQL


def test_historical_durable_dataset_payload_decodes_at_repository_boundary():
    from phylo_lens_server.domain.identity import layout_version_for_dataset
    from phylo_lens_server.domain.legacy_metadata import encode_dataset_annotations
    from phylo_lens_server.domain.models import (
        NEWICK_ROOTING_STRATEGY,
        Dataset,
        DatasetSource,
        GraphNode,
        Isolate,
    )
    from phylo_lens_server.repository.jobs.postgres import decode_dataset_payload

    current = Dataset(
        dataset_id="persisted-compat",
        nodes=(GraphNode(id="a"),),
        edges=(),
        technical_roots=("a",),
        source=DatasetSource(
            format="newick",
            generated_at="fixed",
            rooting_strategy=NEWICK_ROOTING_STRATEGY,
        ),
        isolates_by_node_id={
            "a": (Isolate(id="original", ancillary_data={"country": "PT"}),)
        },
    )
    old = current.model_dump(mode="json")
    old.pop("annotations_by_node_id")
    old.pop("ancillary_schema")
    old.pop("summary_schema")
    old["metadata_by_node_id"] = {}
    old["metadata_schema"] = []
    old["isolates_by_node_id"]["a"][0]["metadata"] = old["isolates_by_node_id"]["a"][
        0
    ].pop("ancillary_data")
    decoded = decode_dataset_payload(old)
    assert decoded == current
    assert encode_dataset_annotations(decoded) == {}
    assert layout_version_for_dataset(decoded) == layout_version_for_dataset(current)
