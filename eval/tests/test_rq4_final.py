from __future__ import annotations

import argparse
from pathlib import Path

import pytest

from phylo_lens_eval.common import checksum_sha256, create_isolated_run_directory
from phylo_lens_eval.rq3_final import parse_canonical_source
from phylo_lens_eval.rq4_final import (
    DEVELOPMENT_RUN_ID_PATTERN,
    EXPERIMENT_ID,
    FINAL_RUN_ID_PATTERN,
    _copy_master_for_runtime,
    _metric,
    _verify_master,
    load_config,
    repository_root,
    run,
    summarize,
    validate_result,
)


def _result(operation: str = "cluster_expand") -> dict:
    request = {
        "fetchInvocationTimestamp": 2.0,
        "dispatchTimestamp": 2.0,
        "responseTimestamp": 3.0,
    }
    return {
        "status": "success",
        "clock_domain": "browser_performance_now",
        "input_event": {
            "timestamp": 1.0,
            "eventType": "click" if operation == "cluster_expand" else "dblclick",
            "isTrusted": True,
        },
        "initial": {"diagnostics": {"snapshotFingerprint": "before"}},
        "pre_operation": {
            "boundary": {"reason": "cluster_expand", "clusterId": "target"},
            "diagnostics": {"snapshotFingerprint": "expanded"},
        },
        "event": {
            "timestamp": 4.0,
            "boundary": {
                "reason": operation
                if operation != "viewport_navigation"
                else "viewport_sync",
                "clusterId": "target",
            },
            "diagnostics": {"snapshotFingerprint": "after"},
        },
        "t_settled": 5.0,
        "gpu": {"hardware_accelerated": True, "backend": "Metal"},
        "baseline_frame_intervals_ms": [16.0],
        "frame_intervals_ms": [17.0, 55.0],
        "relevant_requests": [] if operation == "cluster_collapse" else [request],
        "response_metadata": []
        if operation == "cluster_collapse"
        else [{"status": 200, "truncated": True}],
    }


def _source(config: dict) -> dict:
    return parse_canonical_source(
        repository_root(),
        {
            "dataset": {
                **config["dataset"],
                "expected_canonical_sha256": config["dataset"]["sha256"],
                "declared_node_count": config["dataset"]["node_count"],
                "declared_edge_count": config["dataset"]["edge_count"],
            }
        },
    )


def test_frozen_matrix_and_no_warmups() -> None:
    config = load_config()
    assert [scenario["id"] for scenario in config["scenarios"]] == [
        "navigation",
        "expand-low",
        "collapse-low",
        "expand-representative",
        "collapse-representative",
        "expand-high",
        "collapse-high",
    ]
    assert config["measured_repetitions"] == 7
    assert config["warmup_repetitions"] == config["retries"] == 0
    assert config["timeout_seconds"] == 60


def test_run_id_patterns_accept_only_immutable_final_or_dev_ids() -> None:
    assert FINAL_RUN_ID_PATTERN.fullmatch("thesis-final-rq4-v020-001")
    assert DEVELOPMENT_RUN_ID_PATTERN.fullmatch("dev-rq4-final-navigation-v002-smoke")
    assert not FINAL_RUN_ID_PATTERN.fullmatch("thesis-final-rq4-v020-01")
    assert not DEVELOPMENT_RUN_ID_PATTERN.fullmatch("dev-rq4-final-INVALID")


def test_authoritative_master_is_v002_and_targets_match_semantic_layout() -> None:
    config = load_config()
    master = _verify_master(repository_root(), config, _source(config))
    assert master["physical_sha256"] == config["layout"]["database_sha256"]
    assert master["table_sha256"] == config["layout"]["table_sha256"]
    assert master["layout_id"] == config["layout"]["id"]


def test_runtime_copy_starts_as_exact_byte_copy_without_writing_master(
    tmp_path: Path,
) -> None:
    config = load_config()
    master = _verify_master(repository_root(), config, _source(config))
    before = checksum_sha256(Path(master["path"]))
    runtime = _copy_master_for_runtime(master, tmp_path / "observation")
    assert runtime["initial_sha256"] == before
    assert checksum_sha256(Path(runtime["path"])) == before
    assert checksum_sha256(Path(master["path"])) == before


def test_existing_run_directory_is_refused_before_browser_execution(
    tmp_path: Path,
) -> None:
    run_id = "dev-rq4-final-existing-directory"
    create_isolated_run_directory(tmp_path, EXPERIMENT_ID, run_id)
    with pytest.raises(FileExistsError):
        run(
            argparse.Namespace(
                run_id=run_id,
                results_root=tmp_path,
                scenario=["navigation"],
                repetitions=1,
            )
        )


def test_server_timing_reconciles_and_event_t0_is_required() -> None:
    result = _result()
    assert validate_result("cluster_expand", {"cluster_id": "target"}, result) is None
    result["input_event"]["isTrusted"] = False
    assert (
        validate_result("cluster_expand", {"cluster_id": "target"}, result)
        == "validation_failure"
    )


def test_collapse_prohibits_request_and_requires_preexpanded_state() -> None:
    result = _result("cluster_collapse")
    assert validate_result("cluster_collapse", {"cluster_id": "target"}, result) is None
    result["relevant_requests"] = [{}]
    assert (
        validate_result("cluster_collapse", {"cluster_id": "target"}, result)
        == "validation_failure"
    )


def test_gpu_frame_and_response_metadata_are_not_optional() -> None:
    result = _result()
    result["gpu"]["backend"] = "unknown"
    assert (
        validate_result("cluster_expand", {"cluster_id": "target"}, result)
        == "validation_failure"
    )
    result = _result()
    result["response_metadata"] = []
    assert (
        validate_result("cluster_expand", {"cluster_id": "target"}, result)
        == "validation_failure"
    )


def test_summary_retains_failures_without_pseudo_replication() -> None:
    row = {
        "scenario": "navigation",
        "status": "failure",
        "timing": {
            key: {"state": "unavailable", "value_ms": None}
            for key in (
                "settle_latency_ms",
                "event_to_request_ms",
                "browser_http_ms",
                "response_to_snapshot_ms",
                "event_to_snapshot_ms",
                "snapshot_to_settle_ms",
            )
        },
    }
    output = summarize([row])
    assert output["terminal_count"] == output["failure_count"] == 1
    assert output["conditions"][0]["metrics"]["settle_latency_ms"] is None


def test_metric_marks_collapse_http_as_not_applicable() -> None:
    assert _metric(None, None, False) == {"state": "not_applicable", "value_ms": None}
