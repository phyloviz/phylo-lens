from __future__ import annotations

import json
from pathlib import Path

import pytest

from phylo_lens_eval.core.common import (
    create_isolated_run_directory,
    validate_rq2_final_observation,
)
from phylo_lens_eval.final.rq2.rq2_final import (
    DEVELOPMENT_RUN_ID_PATTERN,
    FINAL_RUN_ID_PATTERN,
    _validate_final_experiment,
    PRODUCT_RELEASE_COMMIT,
    PRODUCT_RELEASE_VERSION,
    load_final_experiment,
    summarize_final_observations,
)
from phylo_lens_eval.final.rq2.rq2_final_audit import audit_run, build_reports


def _observation(condition: dict, role: str, index: int) -> dict:
    primitive = condition["expected_primitive_count"]
    metric = {"state": "available", "bytes": 100 + index, "reason": None}
    return {
        "schema_version": "1",
        "run_id": "thesis-final-rq2-v020-001",
        "experiment_id": "rq2-client-final-v020",
        "observation_id": f"{role}-{index:03d}",
        "role": role,
        "repetition_index": index,
        "status": "success",
        "failure_kind": "none",
        "condition": {
            "id": condition["id"],
            "family": condition["family"],
            "global_prepared_node_count": 100000,
            "max_nodes": 100000,
            "timeout_seconds": 45,
        },
        "fixture": {
            "id": condition["id"],
            "sha256": "a" * 64,
            "response_sha256": "b" * 64,
            "node_count": condition["node_count"],
            "edge_count": condition["node_count"] - 1,
            "triangle_count": condition["triangle_count"],
            "expected_primitive_count": primitive,
            "labels_enabled": False,
            "mutated": False,
        },
        "browser": {
            "version": "test",
            "executable_path": "/browser",
            "playwright_version": "1.55.0",
            "headless": False,
            "viewport": {"width": 960, "height": 640},
            "device_scale_factor": 1,
            "locale": "en-US",
            "timezone": "UTC",
            "fresh_process": True,
        },
        "gpu": {
            "hardware_accelerated": True,
            "webgl_vendor": "Apple",
            "webgl_renderer": "ANGLE Metal",
            "backend": "Metal",
            "evidence": "test",
        },
        "timing": {
            "t0_ms": 1,
            "t1_ms": 2,
            "t2_ms": 3 + index,
            "client_first_visualization_ms": 2 + index,
            "load_resolve_ms": 1,
            "post_load_frame_ms": 1 + index,
        },
        "heap": {"delta": {"js_heap_used_bytes": metric}},
        "rss": {
            "state": "available",
            "scope": "process_tree",
            "sampling_interval_seconds": 0.02,
            "baseline_rss_bytes": 1,
            "post_t2_rss_bytes": 2,
            "peak_rss_bytes": 3 + index,
            "diagnostic_root_rss_bytes": 2,
        },
        "snapshot": {
            "sequence": 1,
            "reason": "initial_load",
            "node_count": condition["node_count"],
            "edge_count": condition["node_count"] - 1,
            "primitive_count": condition["node_count"] * 2 - 1,
            "triangle_count": condition["triangle_count"],
            "fixture_congruent": True,
        },
        "replay": {
            "request_count": 3,
            "viewport_request_count": 1,
            "post_initial_viewport_request_count": 0,
            "request_pattern_valid": True,
            "truncated": False,
            "response_cardinality_valid": True,
            "response_checksums": ["b" * 64],
        },
        "frame_statistics": {
            "sample_count": 3,
            "median_ms": 8,
            "p95_ms": 10,
            "maximum_ms": 11,
            "above_50_ms_count": 0,
        },
        "artifacts": {},
        "error": None,
    }


def test_final_matrix_and_policy_are_frozen() -> None:
    root = Path(__file__).resolve().parents[3]
    experiment = load_final_experiment(root / "config/rq2-experiments.json")
    _validate_final_experiment(experiment)
    assert len(experiment["fixtures"]) == 7
    assert experiment["warmup_repetitions"] == 1
    assert experiment["measured_repetitions"] == 5
    assert experiment["global_prepared_node_count"] == 100000
    assert experiment["max_nodes"] == 100000
    assert experiment["timeout_seconds"] == 45


def test_final_run_ids_are_immutable_and_development_ids_are_separate() -> None:
    assert FINAL_RUN_ID_PATTERN.fullmatch("thesis-final-rq2-v020-001")
    assert not FINAL_RUN_ID_PATTERN.fullmatch("thesis-final-rq2-v020-01")
    assert DEVELOPMENT_RUN_ID_PATTERN.fullmatch("dev-rq2-final-detail-smoke-001")


def test_existing_final_raw_run_directory_is_refused(tmp_path: Path) -> None:
    create_isolated_run_directory(
        tmp_path, "rq2-client-final-v020", "thesis-final-rq2-v020-001"
    )
    with pytest.raises(FileExistsError):
        create_isolated_run_directory(
            tmp_path, "rq2-client-final-v020", "thesis-final-rq2-v020-001"
        )


def test_final_schema_and_summary_exclude_warmups() -> None:
    root = Path(__file__).resolve().parents[3]
    condition = load_final_experiment(root / "config/rq2-experiments.json")["fixtures"][
        0
    ]
    warmup = _observation(condition, "warmup", 0)
    measured = _observation(condition, "measured", 1)
    validate_rq2_final_observation(warmup)
    summary = summarize_final_observations([warmup, measured])
    assert summary["groups"][0]["configured_count"] == 1
    assert (
        summary["groups"][0]["metrics"]["client_first_visualization_ms"]["median"] == 3
    )


def test_failure_observation_retains_truncation_evidence() -> None:
    root = Path(__file__).resolve().parents[3]
    condition = load_final_experiment(root / "config/rq2-experiments.json")["fixtures"][
        0
    ]
    failure = _observation(condition, "measured", 1)
    failure.update(
        status="invalid",
        failure_kind="unexpected_truncation",
        error="Fixture response was truncated.",
    )
    failure["replay"]["truncated"] = True
    validate_rq2_final_observation(failure)


def test_final_audit_and_raw_only_reports(tmp_path: Path) -> None:
    root = Path(__file__).resolve().parents[3]
    config = load_final_experiment(root / "config/rq2-experiments.json")
    run_dir = tmp_path / "rq2-client-final-v020" / "thesis-final-rq2-v020-001"
    run_dir.mkdir(parents=True)
    rows = []
    for condition in config["fixtures"]:
        rows.append(_observation(condition, "warmup", 0))
        rows.extend(_observation(condition, "measured", index) for index in range(1, 6))
    manifest = {
        "experiment_id": "rq2-client-final-v020",
        "run_id": "thesis-final-rq2-v020-001",
        "state": "completed",
        "expected_terminal_observations": 42,
        "observed_terminal_observations": 42,
        "policy": {
            "retries": 0,
            "global_prepared_node_count": 100000,
            "max_nodes": 100000,
        },
        "browser": config["browser"],
        "scientific_scope": config["scientific_scope"],
        "environment": {},
        "product": {
            "version": PRODUCT_RELEASE_VERSION,
            "release_commit": PRODUCT_RELEASE_COMMIT,
            "source_diff_empty": True,
        },
        "observed_browser_versions": ["test"],
        "observed_playwright_versions": ["1.55.0"],
        "fixture_sha256": {item["id"]: "a" * 64 for item in config["fixtures"]},
    }
    (run_dir / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    (run_dir / "resolved-config.json").write_text(json.dumps(config), encoding="utf-8")
    (run_dir / "observations.jsonl").write_text(
        "".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8"
    )
    (run_dir / "summary.json").write_text(
        json.dumps(summarize_final_observations(rows)), encoding="utf-8"
    )
    audit = audit_run(run_dir)
    assert audit["pass"], audit["errors"]
    first = build_reports(run_dir, "c" * 40, audit)
    assert first == build_reports(run_dir, "c" * 40, audit)
    assert {
        "rq2-summary.json",
        "rq2-first-visualization.csv",
        "rq2-memory.csv",
        "rq2-frame-pacing.csv",
        "rq2-provenance.json",
        "rq2-first-visualization.svg",
        "rq2-memory.svg",
    } == set(first)
