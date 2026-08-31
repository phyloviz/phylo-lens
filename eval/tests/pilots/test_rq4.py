from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from pathlib import Path

import pytest

import phylo_lens_eval.pilots.rq4 as rq4_module
from phylo_lens_eval.core.common import validate_rq4_observation
from phylo_lens_eval.pilots.rq4 import (
    POLICY,
    deterministic_newick,
    load_experiment,
    observation,
    repository_root,
    run,
    select_aggregate_target,
    validation_failure,
)


def test_rq4_pilot_is_public_bootstrap_warm_session() -> None:
    experiment = load_experiment(
        repository_root() / "eval/config/rq4-experiments.json", "rq4-interactive-pilot"
    )
    assert experiment["server_state_policy"] == POLICY
    assert {item["operation"] for item in experiment["scenarios"]} == {
        "viewport_navigation",
        "cluster_expand",
        "cluster_collapse",
    }


def test_rq4_requires_lod_sized_deterministic_pilot() -> None:
    with pytest.raises(ValueError, match="more than 6000"):
        deterministic_newick(6000)
    assert deterministic_newick(6001) == deterministic_newick(6001)


def test_rq4_schema_represents_local_collapse_as_not_applicable_http_metrics(
    tmp_path,
) -> None:
    result = {
        "status": "success",
        "initial": {"boundary": {"layoutVersion": "layout"}},
        "event": {},
        "request_trace": [],
        "frame_intervals_ms": [],
        "t0": 1.0,
        "t3": 2.0,
        "t4": 3.0,
        "target": None,
    }
    row = observation(
        {"id": "rq4"},
        {"id": "collapse", "operation": "cluster_collapse"},
        hashlib.sha256(b"x").hexdigest(),
        0,
        False,
        result,
        tmp_path,
        "http://127.0.0.1:1",
    )
    validate_rq4_observation(row)
    assert row["timing"]["api_round_trip_ms"]["state"] == "not_applicable"
    assert row["timing"]["end_to_end_latency_ms"]["value_ms"] == 2.0
    row["timing"]["t0_ms"] = -1.0
    with pytest.raises(ValueError, match="less than the minimum"):
        validate_rq4_observation(row)


def test_rq4_aggregate_selection_is_exact_or_stably_sorted() -> None:
    targets = [
        {"clusterId": "cluster-z", "representedNodeCount": 2},
        {"clusterId": "cluster-a", "representedNodeCount": 4},
    ]
    assert select_aggregate_target(targets, None) == targets[1]
    assert select_aggregate_target(targets, "cluster-z") == targets[0]
    assert select_aggregate_target(targets, "missing") is None


def test_rq4_uses_the_running_python_for_its_server(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    commands: list[list[str]] = []

    class FinishedProcess:
        def poll(self) -> int:
            return 0

    def fake_popen(command: list[str], **_kwargs: object) -> FinishedProcess:
        commands.append(command)
        return FinishedProcess()

    def fail_readiness(*_args: object) -> None:
        raise RuntimeError("server_start_failure")

    monkeypatch.setattr(rq4_module.subprocess, "Popen", fake_popen)
    monkeypatch.setattr(rq4_module, "wait_ready", fail_readiness)
    monkeypatch.setattr(rq4_module, "free_port", lambda: 8000)
    rq4_module._repetition(
        repository_root(),
        tmp_path / "run",
        {"id": "rq4", "timeout_seconds": 1, "browser": {}},
        {"id": "navigation", "operation": "viewport_navigation", "input": {}},
        "(A:1,B:1)root;",
        hashlib.sha256(b"fixture").hexdigest(),
        0,
        False,
    )

    assert commands[0][0] == sys.executable


def _server_backed_result() -> dict:
    initial = {
        "boundary": {
            "reason": "initial_load",
            "layoutVersion": "layout",
            "clusterId": None,
        },
        "diagnostics": {"snapshotFingerprint": "before"},
    }
    event = {
        "boundary": {
            "reason": "viewport_sync",
            "layoutVersion": "layout",
            "clusterId": None,
        },
        "diagnostics": {"snapshotFingerprint": "after"},
    }
    return {
        "status": "success",
        "clock_domain": "browser_performance_now",
        "initial": initial,
        "event": event,
        "target": None,
        "t0": 1.0,
        "t3": 4.0,
        "t4": 5.0,
        "relevant_requests": [
            {
                "url": "http://api/api/graph/viewport",
                "clock": "browser_performance_now",
                "dispatchTimestamp": 2.0,
                "responseTimestamp": 3.0,
                "status": 200,
            }
        ],
        "operation_request_trace": [{"url": "http://api/api/graph/viewport"}],
        "operation_network_requests": [{"url": "http://api/api/graph/viewport"}],
        "web_origin": "http://web",
    }


def test_rq4_server_backed_timestamps_and_request_are_correlated() -> None:
    assert (
        validation_failure("viewport_navigation", _server_backed_result(), "http://api")
        is None
    )


def test_rq4_rejects_missing_request_and_external_network() -> None:
    missing = _server_backed_result()
    missing["relevant_requests"] = []
    assert (
        validation_failure("viewport_navigation", missing, "http://api")
        == "expected_request_not_observed"
    )
    external = _server_backed_result()
    external["operation_network_requests"] = [{"url": "https://example.invalid/track"}]
    assert (
        validation_failure("viewport_navigation", external, "http://api")
        == "external_network_request"
    )


def test_rq4_rejects_non_monotonic_and_unchanged_structural_state() -> None:
    non_monotonic = _server_backed_result()
    non_monotonic["t3"] = 2.5
    assert (
        validation_failure("viewport_navigation", non_monotonic, "http://api")
        == "harness_protocol_failure"
    )
    unchanged = _server_backed_result()
    unchanged["event"]["diagnostics"]["snapshotFingerprint"] = "before"
    assert (
        validation_failure("viewport_navigation", unchanged, "http://api")
        == "structural_state_unchanged"
    )


def test_rq4_rejects_a_non_browser_clock_timestamp_source() -> None:
    result = _server_backed_result()
    result["clock_domain"] = "node_performance_now"
    assert (
        validation_failure("viewport_navigation", result, "http://api")
        == "harness_protocol_failure"
    )

    result = _server_backed_result()
    result["relevant_requests"][0]["clock"] = "node_performance_now"
    assert (
        validation_failure("viewport_navigation", result, "http://api")
        == "harness_protocol_failure"
    )


def test_rq4_keeps_unrelated_requests_as_diagnostics() -> None:
    result = _server_backed_result()
    result["operation_request_trace"].append({"url": "http://api/health"})
    assert validation_failure("viewport_navigation", result, "http://api") is None


@pytest.mark.skipif(
    os.environ.get("RQ4_SMOKE") != "1",
    reason="requires built browser and Playwright Chromium",
)
def test_python_orchestrated_public_bootstrap_smoke(tmp_path) -> None:
    run_dir = run(
        argparse.Namespace(
            experiment="rq4-interactive-pilot",
            warmups=0,
            repetitions=1,
            results_root=tmp_path,
        )
    )
    rows = [
        json.loads(line)
        for line in (run_dir / "observations.jsonl").read_text().splitlines()
    ]
    assert {row["operation"] for row in rows} == {
        "viewport_navigation",
        "cluster_expand",
        "cluster_collapse",
    }
    assert all(row["status"] == "success" for row in rows)
    assert all(row["server_state_policy"] == POLICY for row in rows)
    assert all(Path(row["artifacts"]["screenshot"]).is_file() for row in rows)
