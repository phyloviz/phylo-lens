from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import pytest
from phylo_lens_eval.core.common import validate_rq2_observation
from phylo_lens_eval.pilots.rq2 import (
    _load_render_peak,
    _run_node_and_monitor,
    _valid_first_render_timing,
    frame_statistics,
    load_rq2_experiment,
    run,
    summarize_rq2_observations,
)


def _observation(
    *, warmup: bool = False, status: str = "success", scope: str = "process_tree"
) -> dict:
    metric = {"state": "available", "bytes": 1, "reason": None}
    unavailable = {"state": "unavailable", "bytes": None, "reason": "unsupported"}
    heap = {
        "js_heap_used_bytes": metric,
        "js_heap_total_bytes": metric,
        "embedder_heap_used_bytes": unavailable,
        "backing_storage_bytes": unavailable,
    }
    return {
        "schema_version": "1",
        "experiment_id": "rq2-test",
        "observation_id": "measured-001",
        "warmup": warmup,
        "repetition_index": 0,
        "status": status,
        "failure_kind": "none"
        if status == "success"
        else "unexpected_viewport_request",
        "fixture": {
            "id": "fixture",
            "generator_version": "v1",
            "random_seed": 1,
            "checksum_sha256": "a" * 64,
            "node_count": 2,
            "edge_count": 1,
            "triangle_count": 1,
            "total_primitive_count": 4,
            "bounds": {"min_x": -1, "max_x": 1, "min_y": -1, "max_y": 1},
            "labels_enabled": False,
            "metadata_configuration": "none",
            "api_contract_version": "1",
        },
        "browser": {
            "version": "test",
            "executable_path": None,
            "headless": True,
            "viewport": {"width": 100, "height": 100},
            "device_scale_factor": 1,
            "locale": "en-US",
            "timezone": "UTC",
            "launch_args": [],
        },
        "timing": {
            "load_to_snapshot_applied_ms": 1,
            "load_to_post_update_frame_ms": 2,
            "snapshot_applied_to_frame_ms": 1,
        },
        "heap": {"baseline": heap, "post_render": heap, "delta": heap},
        "rss": {
            "sampling_interval_seconds": 0.02,
            "scope": scope,
            "baseline_rss_bytes": 1,
            "post_render_rss_bytes": 2,
            "maximum_rss_bytes": 3,
            "post_render_delta_bytes": 1,
            "peak_delta_bytes": 2,
        },
        "frame_statistics": {
            **frame_statistics([10, 20, 30], 16.7),
            "frame_budget_ms": 16.7,
            "minimum_sample_count": 1,
        },
        "artifacts": {
            key: "artifact"
            for key in (
                "request",
                "runtime_state",
                "phase_ack",
                "browser_result",
                "frame_samples",
                "request_samples",
                "stdout",
                "stderr",
                "replay_access_log",
                "screenshot",
            )
        },
        "replay": {
            "request_count": 3,
            "post_initial_viewport_request_count": 0,
            "input_record": None,
        },
        "warnings": [],
        "error": None if status == "success" else "invalidated",
    }


def test_rq2_config_and_observation_schema() -> None:
    root = Path(__file__).resolve().parents[2]
    experiment = load_rq2_experiment(
        root / "config/rq2-experiments.json", "rq2-client-pilot"
    )
    assert experiment["fixtures"][0]["triangle_count"] == 6
    validate_rq2_observation(_observation())


def test_frame_statistics_are_per_repetition_and_not_pooled() -> None:
    statistics = frame_statistics([10, 20, 40, 60], 16.7)
    assert statistics["sample_count"] == 4
    assert statistics["above_33_3_ms_count"] == 2
    warmup = _observation(warmup=True)
    measured = _observation()
    measured["frame_statistics"]["median_ms"] = 40
    summary = summarize_rq2_observations([warmup, measured])
    assert summary["groups"][0]["configured_count"] == 1
    assert summary["groups"][0]["metrics"]["frame_median_ms"]["median"] == 40


def test_load_render_peak_excludes_samples_from_other_phases() -> None:
    baseline_rss = 100
    load_render_samples = [110, 125, 120]
    frame_and_cleanup_rss = [999, 1000]
    assert _load_render_peak(load_render_samples) == 125
    assert max([baseline_rss, *load_render_samples, *frame_and_cleanup_rss]) == 1000


def test_first_render_timing_requires_monotonic_finite_values() -> None:
    assert _valid_first_render_timing({"t0_ms": 1, "t1_ms": 2, "t2_ms": 3})
    assert not _valid_first_render_timing(
        {"t0_ms": 1, "t1_ms": float("nan"), "t2_ms": 3}
    )
    assert not _valid_first_render_timing({"t0_ms": 2, "t1_ms": 1, "t2_ms": 3})


def test_rq2_summary_separates_memory_scope_and_retains_invalid() -> None:
    process_tree = _observation(scope="process_tree")
    root_only_invalid = _observation(status="invalid", scope="root_only")
    summary = summarize_rq2_observations([process_tree, root_only_invalid])
    assert len(summary["groups"]) == 2
    invalid_group = next(
        group
        for group in summary["groups"]
        if group["conditions"]["memory_scope"] == "root_only"
    )
    assert invalid_group["invalid_count"] == 1
    assert invalid_group["success_count"] == 0


def test_runtime_state_timeout_is_retained(tmp_path: Path) -> None:
    paths = {
        "stdout": tmp_path / "stdout.jsonl",
        "stderr": tmp_path / "stderr.log",
        "runtime_state": tmp_path / "runtime-state.json",
    }
    _runtime, monitor = _run_node_and_monitor(
        [sys.executable, "-c", "import time; time.sleep(10)"],
        tmp_path,
        paths,
        0.03,
        0.005,
    )
    assert monitor.get("timed_out") is not True
    assert monitor["runtime_state_timeout"] is True


@pytest.mark.skipif(
    os.environ.get("RQ2_SMOKE") != "1",
    reason="requires built browser and Playwright Chromium",
)
def test_python_orchestrated_headless_smoke(tmp_path: Path) -> None:
    run_dir = run(
        argparse.Namespace(
            experiment="rq2-client-pilot",
            warmups=0,
            repetitions=1,
            timeout_seconds=30,
            results_root=tmp_path,
        )
    )
    observation = json.loads(
        next(run_dir.glob("repetitions/*/measured-001/observation.json")).read_text()
    )
    browser_result = json.loads(
        next(run_dir.glob("repetitions/*/measured-001/browser-result.json")).read_text()
    )
    validate_rq2_observation(observation)
    assert observation["status"] == "success"
    assert browser_result["timing"]["t2_ms"] >= browser_result["timing"]["t1_ms"]
