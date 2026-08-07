from __future__ import annotations

import json
from pathlib import Path

import pytest
from phylo_lens_eval.common import (
    checksum_sha256,
    classify_failure,
    create_isolated_run_directory,
    new_run_id,
    persisted_size_bytes,
    validate_manifest,
    validate_observation,
)
from phylo_lens_eval.config import (
    ConfigurationError,
    load_datasets,
    load_experiments,
    resolve_experiment,
)


def test_checksum_is_stable_for_known_bytes(tmp_path: Path) -> None:
    source = tmp_path / "input.nwk"
    source.write_bytes(b"(A,B);")
    assert (
        checksum_sha256(source)
        == "b48c4013a84c2110b0dedfdbf9bf417f3feba40893dade8c49ef4668d6aa55bd"
    )


def test_run_ids_are_unique() -> None:
    assert new_run_id() != new_run_id()


def test_result_directory_collision_fails_without_overwrite(tmp_path: Path) -> None:
    first = create_isolated_run_directory(tmp_path, "rq1", "fixed-run")
    (first / "sentinel").write_text("preserve", encoding="utf-8")
    with pytest.raises(FileExistsError):
        create_isolated_run_directory(tmp_path, "rq1", "fixed-run")
    assert (first / "sentinel").read_text(encoding="utf-8") == "preserve"


def test_persisted_size_counts_only_sqlite_artifacts(tmp_path: Path) -> None:
    (tmp_path / "prepared_layout.sqlite3").write_bytes(b"database")
    (tmp_path / "prepared_layout.sqlite3-wal").write_bytes(b"wal")
    (tmp_path / "prepared_layout.sqlite3-shm").write_bytes(b"shm")
    (tmp_path / "stdout.log").write_bytes(b"excluded")
    (tmp_path / "manifest.json").write_bytes(b"excluded")
    assert persisted_size_bytes(tmp_path) == 14


def test_manifest_and_observation_validation() -> None:
    manifest = {
        "schema_version": "1",
        "experiment_id": "rq1",
        "run_id": "run",
        "timestamp_utc": "2026-01-01T00:00:00Z",
        "git": {"available": False, "commit": None, "dirty": False},
        "environment": {
            "operating_system": "test",
            "cpu_model": "test",
            "logical_cpu_count": 1,
            "total_ram_bytes": 0,
            "python_version": "test",
            "java_version": None,
            "graphviz_version": None,
            "docker_version": None,
            "phylolens": {"api_contract_version": "1", "server_version": "1"},
        },
        "dataset": {"id": "dataset"},
        "parameters": {
            "experiment_id": "rq1",
            "dataset_ids": ["dataset"],
            "warmup_repetitions": 0,
            "measured_repetitions": 1,
            "timeout_seconds": 1.0,
            "persistence_backend": "sqlite",
            "peak_rss_sampling_interval_seconds": 0.02,
        },
        "state": "running",
    }
    validate_manifest(manifest)
    observation = {
        "schema_version": "1",
        "observation_id": "one",
        "dataset_id": "dataset",
        "warmup": False,
        "state": "success",
        "failure_classification": "none",
        "wall_time_seconds": 1.0,
        "stage_durations_seconds": {},
        "warnings": [],
        "exit_status": 0,
        "error": None,
        "peak_rss_bytes": 1,
        "peak_rss_scope": "sampled_process_tree",
        "input_bytes": 1,
        "persisted_artifact_bytes": 1,
        "declared_node_count": None,
        "declared_edge_count": None,
        "observed_node_count": 1,
        "edge_count": 0,
        "lod_tier_count": 1,
        "cluster_count": 1,
        "layout_status": "ready",
    }
    validate_observation(observation)
    with pytest.raises(ValueError):
        validate_manifest({})
    observation["unexpected"] = True
    with pytest.raises(ValueError, match="unexpected"):
        validate_observation(observation)


def test_failure_classification_distinguishes_timeout_and_kill() -> None:
    assert classify_failure(-9, False) == "oom"
    assert classify_failure(1, True) == "timeout"
    assert classify_failure(1, False) == "runtime_error"


def test_configuration_validation_rejects_invalid_repetitions(tmp_path: Path) -> None:
    catalog = tmp_path / "datasets.json"
    catalog.write_text(
        json.dumps({"schema_version": "1", "datasets": []}), encoding="utf-8"
    )
    experiments = tmp_path / "experiments.json"
    experiments.write_text(
        json.dumps(
            {
                "schema_version": "1",
                "experiments": [
                    {
                        "id": "bad",
                        "research_question": "RQ1",
                        "pipeline": "direct-tree",
                        "dataset_ids": ["absent"],
                        "warmup_repetitions": 0,
                        "measured_repetitions": 0,
                        "timeout_seconds": 1,
                        "persistence_backend": "sqlite",
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    assert load_datasets(catalog, tmp_path) == {}
    with pytest.raises(ConfigurationError, match="measured_repetitions"):
        load_experiments(experiments)


def test_configuration_catalog_resolves_repository_fixture() -> None:
    eval_root = Path(__file__).resolve().parents[1]
    datasets = load_datasets(eval_root / "config/datasets.json", eval_root.parent)
    experiment = resolve_experiment(
        "rq1-direct-tree",
        load_experiments(eval_root / "config/experiments.json"),
        datasets,
    )
    assert experiment.persistence_backend == "sqlite"
