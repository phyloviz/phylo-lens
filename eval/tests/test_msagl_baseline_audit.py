from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path
from types import SimpleNamespace

import pytest

import phylo_lens_eval.msagl_baseline_audit as audit_module
from phylo_lens_eval.msagl_baseline import adapt_newick
from phylo_lens_eval.msagl_baseline_audit import (
    MSAuditError,
    audit,
    comparison_rows,
    raw_summary,
    write_report,
)


def _native(total: float = 35.0) -> dict:
    return {
        "status": "success",
        "native_path": "MdsLayoutSettings+layoutGraphWithMds+Sleeve+TileMap.buildUpToLevel",
        "execution_evidence": {
            "mds_layout_settings_constructed": True,
            "layout_graph_with_mds_called": True,
            "edge_routing_mode": "Sleeve",
            "tile_map_build_completed": True,
        },
        "nodes": 5,
        "edges": 4,
        "parse_ms": 10.0,
        "geometry_ms": 1.0,
        "layout_ms": 20.0,
        "cdt_ms": 2.0,
        "routing_ms": 3.0,
        "routing_phases_ms": 5.0,
        "tiling_ms": 4.0,
        "other_ms": total - 35.0,
        "total_ms": total,
        "tile_level_upper_bound": 30,
        "tile_capacity": 500,
        "native_max_memory_bytes": 4 * 1024 * 1024 * 1024,
        "actual_levels_built": 9,
        "tile_map_number_of_levels": 9,
        "browser": {"page_errors": [], "clean_exit": True},
    }


def _row(state: str = "success", phase: str = "measured", total: float = 35.0) -> dict:
    row = {
        "observation_id": f"{phase}-000-balanced-5000",
        "condition_id": "balanced-5000",
        "warmup": phase == "warmup",
        "repetition_index": 0,
        "state": state,
        "attempt_count": 1,
        "retry_permitted": False,
        "timeout_seconds": 300,
        "source_sha256": "source",
        "adapted_sha256": "adapted",
        "node_count": 5,
        "edge_count": 4,
        "native": _native(total) if state == "success" else {},
        "outer_watchdog": {"timed_out": state == "timeout"},
    }
    return row


def _development_run(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    source = tmp_path / "source.newick"
    source.write_text("((a,b),c);", encoding="utf-8")
    adaptation = adapt_newick(source)
    condition = {
        "id": "balanced-5000",
        "absolute_path": str(source),
        "requested_leaves": 5000,
        "parsed_nodes": 5,
        "parsed_edges": 4,
        "topology": "balanced",
        "seed": None,
        "sha256": adaptation["source_sha256"],
    }
    monkeypatch.setattr(
        audit_module, "_conditions", lambda: {condition["id"]: condition}
    )
    run_dir = tmp_path / "run"
    observation_dir = run_dir / "conditions/balanced-5000/smoke-000-balanced-5000"
    observation_dir.mkdir(parents=True)
    row = _row(phase="smoke")
    row["source_sha256"] = adaptation["source_sha256"]
    row["adapted_sha256"] = adaptation["adapted_sha256"]
    manifest = {
        "state": "completed",
        "run_id": "dev-msagljs-mds-smoke-999",
        "run_kind": "development_smoke",
        "development_evidence_only": True,
        "expected_raw_observations": 1,
        "provenance": {
            "msagljs_commit": "db1ecbba39f46ca83aa90a87bad2012757e51f42",
            "yarn_lock_sha256": "ac84ae8de6bcbbf407a8a85592c8f1bcfa1758f7f24c3a0d33428db72b71b06e",
            "native_path": "MdsLayoutSettings+layoutGraphWithMds+Sleeve+TileMap.buildUpToLevel",
            "paper_discrepancy": "paper IPSep-CoLa; pinned public loading benchmark MDS",
            "timeout_seconds": 300,
            "host": {},
            "browser_lifecycle": "one fresh Chromium process and one fresh context/page per observation",
            "outer_watchdog": {"deadline_seconds": 300},
            "repetition_policy": {"retries_permitted": 0},
            "tile_map": {
                "tile_capacity": 500,
                "native_max_memory_bytes": 4 * 1024 * 1024 * 1024,
                "tile_level_upper_bound": 30,
            },
        },
    }
    (run_dir / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    (run_dir / "observations.jsonl").write_text(
        json.dumps(row) + "\n", encoding="utf-8"
    )
    (observation_dir / "observation.json").write_text(json.dumps(row), encoding="utf-8")
    (observation_dir / "adaptation.json").write_text(
        json.dumps(
            {
                key: adaptation[key]
                for key in (
                    "source_sha256",
                    "adapted_sha256",
                    "node_count",
                    "edge_count",
                )
            }
        ),
        encoding="utf-8",
    )
    (observation_dir / "graph.tsv").write_bytes(adaptation["payload"])
    for name in ("runner.stdout.txt", "runner.stderr.txt"):
        (observation_dir / name).write_text("", encoding="utf-8")
    (observation_dir / "outer-watchdog.json").write_text("{}", encoding="utf-8")
    return run_dir


def _clean_product_tree(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        audit_module.subprocess,
        "run",
        lambda *_args, **_kwargs: SimpleNamespace(returncode=0),
    )


def test_statistics_are_deterministic_and_exclude_warmups_failures_and_timeouts() -> (
    None
):
    rows = [
        _row(phase="warmup", total=99),
        _row(total=10),
        _row(total=20),
        _row("failure"),
        _row("timeout"),
    ]
    rows[1]["observation_id"] = "measured-001-balanced-5000"
    rows[2]["observation_id"] = "measured-002-balanced-5000"
    summary = raw_summary(rows)
    group = summary["groups"][0]
    assert group["warmup_count"] == 1
    assert group["observed_measured_count"] == 4
    assert group["measured_successes"] == 2
    assert group["measured_failures"] == 1
    assert group["measured_timeouts"] == 1
    assert group["metrics_ms"]["total_ms"]["median"] == 15


def test_partial_success_statistics_and_topologies_do_not_pool() -> None:
    rows = [_row(total=float(value)) for value in (1, 2, 3, 4, 5)]
    for index, row in enumerate(rows):
        row["observation_id"] = f"measured-{index:03d}-balanced-5000"
        row["repetition_index"] = index
    rows[-1]["state"] = "failure"
    other = deepcopy(rows[0])
    other["condition_id"] = "caterpillar-5000"
    other["observation_id"] = "measured-000-caterpillar-5000"
    other["topology"] = "caterpillar"
    output = raw_summary(rows + [other])
    assert len(output["groups"]) == 2
    balanced = next(
        group for group in output["groups"] if group["condition_id"] == "balanced-5000"
    )
    assert balanced["metrics_ms"]["total_ms"]["count"] == 4
    assert balanced["metrics_ms"]["total_ms"]["median"] == 2.5


@pytest.mark.parametrize(
    "field", ["msagljs_commit", "yarn_lock_sha256", "timeout_seconds"]
)
def test_audit_rejects_wrong_provenance(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, field: str
) -> None:
    run_dir = _development_run(tmp_path, monkeypatch)
    manifest = json.loads((run_dir / "manifest.json").read_text())
    manifest["provenance"][field] = "wrong" if field != "timeout_seconds" else 12
    (run_dir / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    codes = {reason["code"] for reason in audit(run_dir, mode="development")["reasons"]}
    assert {"upstream_sha", "lockfile_sha", "deadline"} & codes


def test_audit_detects_retry_duplicate_smoke_contamination_and_bad_timing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    run_dir = _development_run(tmp_path, monkeypatch)
    row = json.loads((run_dir / "observations.jsonl").read_text())
    row["attempt_count"] = 2
    row["native"]["total_ms"] += 1
    (run_dir / "observations.jsonl").write_text(
        json.dumps(row) + "\n" + json.dumps(row) + "\n", encoding="utf-8"
    )
    report = audit(run_dir, mode="final")
    codes = {reason["code"] for reason in report["reasons"]}
    assert {
        "retry_detected",
        "duplicate_observation",
        "smoke_contamination",
        "timing_reconciliation",
    } <= codes


def test_tile_level_index_30_allows_31_levels(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    run_dir = _development_run(tmp_path, monkeypatch)
    _clean_product_tree(monkeypatch)
    row = json.loads((run_dir / "observations.jsonl").read_text())
    row["native"]["actual_levels_built"] = 31
    row["native"]["tile_map_number_of_levels"] = 31
    (run_dir / "observations.jsonl").write_text(
        json.dumps(row) + "\n", encoding="utf-8"
    )
    observation = (
        run_dir / "conditions/balanced-5000/smoke-000-balanced-5000/observation.json"
    )
    observation.write_text(json.dumps(row), encoding="utf-8")
    assert audit(run_dir, mode="development")["status"] == "PASS"


def test_comparison_rejects_nonmatching_condition(tmp_path: Path) -> None:
    summary = {
        "groups": [
            {
                "topology": "balanced",
                "requested_leaves": 7,
                "parsed_nodes": 13,
                "metrics_ms": {"total_ms": {"count": 1}},
            }
        ]
    }
    (tmp_path / "observations.jsonl").write_text("", encoding="utf-8")
    with pytest.raises(MSAuditError, match="no matching"):
        comparison_rows(summary, tmp_path)


def test_development_report_is_byte_deterministic(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    run_dir = _development_run(tmp_path, monkeypatch)
    rq1 = tmp_path / "rq1"
    rq1.mkdir()
    (rq1 / "observations.jsonl").write_text(
        json.dumps(
            {
                "phase": "measured",
                "status": "success",
                "topology": "balanced",
                "requested_leaves": 5000,
                "parsed_nodes": 5,
                "timing": {"preparation_wall_ms": 9.0},
            }
        )
        + "\n",
        encoding="utf-8",
    )
    first, second = tmp_path / "first", tmp_path / "second"
    write_report(run_dir, first, rq1_run_dir=rq1, reporting_audit_commit="test")
    write_report(run_dir, second, rq1_run_dir=rq1, reporting_audit_commit="test")
    assert {path.name: path.read_bytes() for path in first.iterdir()} == {
        path.name: path.read_bytes() for path in second.iterdir()
    }


def test_audit_checks_byte_for_byte_derived_congruence(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    run_dir = _development_run(tmp_path, monkeypatch)
    _clean_product_tree(monkeypatch)
    rq1 = tmp_path / "rq1"
    rq1.mkdir()
    (rq1 / "observations.jsonl").write_text(
        json.dumps(
            {
                "phase": "measured",
                "status": "success",
                "topology": "balanced",
                "requested_leaves": 5000,
                "parsed_nodes": 5,
                "timing": {"preparation_wall_ms": 9.0},
            }
        )
        + "\n",
        encoding="utf-8",
    )
    output = tmp_path / "derived"
    write_report(run_dir, output, rq1_run_dir=rq1, reporting_audit_commit="test")
    result = audit(
        run_dir,
        mode="development",
        derived_dir=output,
        rq1_run_dir=rq1,
        reporting_audit_commit="test",
    )
    assert result["status"] == "PASS"
    assert result["report_congruent"] is True
    (output / "msagljs-summary.json").write_text("changed", encoding="utf-8")
    result = audit(
        run_dir,
        mode="development",
        derived_dir=output,
        rq1_run_dir=rq1,
        reporting_audit_commit="test",
    )
    assert result["status"] == "FAIL"
    assert result["reasons"][0]["code"] == "report_congruence"
