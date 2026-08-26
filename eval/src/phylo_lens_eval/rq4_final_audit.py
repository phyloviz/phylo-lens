"""Raw-only deterministic reporting and audit for final RQ4 evidence."""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
from pathlib import Path
from typing import Any

from .common import write_json
from .rq4_final import (
    FINAL_RUN_ID_PATTERN,
    _verify_master,
    load_config,
    parse_canonical_source,
    repository_root,
    summarize,
    validate_result,
)
from .stats import summary

EXECUTION_HARNESS_COMMIT = "6479542144689d27e057a7333919653130f92222"


def _rows(run_dir: Path) -> list[dict[str, Any]]:
    return [
        json.loads(line)
        for line in (run_dir / "observations.jsonl").read_text().splitlines()
        if line
    ]


def _digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _replay_result(row: dict[str, Any]) -> dict[str, Any]:
    timing = row["timing"]
    return {
        "status": "success",
        "clock_domain": "browser_performance_now",
        "input_event": {
            "timestamp": timing["t0_event_ms"],
            "eventType": "click"
            if row["scenario"].startswith("expand")
            else "dblclick",
            "nativeEventType": "click"
            if row["scenario"].startswith(("expand", "collapse"))
            else "dblclick",
            "clickCount": 1 if row["scenario"].startswith("expand") else 2,
            "capturePhase": True,
            "stage": "graph-root",
            "targetClusterId": row.get("target", {}).get("cluster_id")
            if row.get("target")
            else None,
            "isTrusted": True,
        },
        "event": row["observer"]["after"],
        "initial": row["observer"]["initial"],
        "pre_operation": row["observer"]["pre_operation"],
        "t_settled": timing["t_settled_ms"],
        "gpu": row["gpu"],
        "baseline_frame_intervals_ms": row["baseline_frames"]["intervals_ms"],
        "frame_intervals_ms": row["operation_frames"]["intervals_ms"],
        "relevant_requests": row["requests"]["relevant"],
        "response_metadata": row["requests"]["response_metadata"],
    }


def _audit_execution_provenance(manifest: dict[str, Any], errors: list[str]) -> None:
    """The manifest's ordinary Git record is the execution provenance source."""
    if manifest.get("git", {}).get("commit") != EXECUTION_HARNESS_COMMIT:
        errors.append("execution_git_commit_mismatch")


def audit(run_dir: Path, *, require_final: bool = True) -> dict[str, Any]:
    config, manifest, rows = (
        load_config(),
        json.loads((run_dir / "manifest.json").read_text()),
        _rows(run_dir),
    )
    errors: list[str] = []
    _audit_execution_provenance(manifest, errors)
    expected_count = (
        49 if require_final else manifest.get("expected_terminal_observations")
    )
    if manifest.get("state") != "completed":
        errors.append("manifest_not_completed")
    if require_final and not FINAL_RUN_ID_PATTERN.fullmatch(manifest.get("run_id", "")):
        errors.append("run_id_not_final")
    if len(rows) != expected_count:
        errors.append("terminal_count_mismatch")
    if manifest.get("observed_terminal_observations") != len(rows):
        errors.append("manifest_terminal_count_mismatch")
    parameters = manifest.get("parameters", {})
    if (
        parameters.get("warmup_repetitions") != 0
        or parameters.get("timeout_seconds") != 60
        or manifest.get("rq4", {}).get("frame_budget_ms") != 50
    ):
        errors.append("frozen_policy_mismatch")
    if any(row.get("role") != "measured" for row in rows):
        errors.append("warmup_or_unexpected_role")
    root = repository_root()
    source = parse_canonical_source(
        root,
        {
            "dataset": {
                **config["dataset"],
                "expected_canonical_sha256": config["dataset"]["sha256"],
                "declared_node_count": config["dataset"]["node_count"],
                "declared_edge_count": config["dataset"]["edge_count"],
            }
        },
    )
    try:
        master = _verify_master(root, config, source)
    except ValueError as error:
        errors.append(f"authoritative_master:{error}")
        master = None
    definitions = {item["id"]: item for item in config["scenarios"]}
    if any(row.get("scenario") not in definitions for row in rows):
        errors.append("unknown_scenario")
    for scenario, definition in definitions.items():
        cases = [row for row in rows if row.get("scenario") == scenario]
        if len(cases) != (7 if require_final else len(cases)):
            errors.append(f"scenario_count:{scenario}")
        for row in cases:
            provenance = row.get("provenance", {})
            if provenance.get("product_commit") != config["product"]["release_commit"]:
                errors.append(f"product_provenance:{scenario}")
            if master and (
                provenance.get("authoritative_master", {}).get("physical_sha256")
                != master["physical_sha256"]
                or provenance.get("authoritative_master", {}).get("table_sha256")
                != master["table_sha256"]
                or provenance.get("runtime_copy", {}).get("initial_sha256")
                != master["physical_sha256"]
            ):
                errors.append(f"runtime_copy_identity:{row.get('observation_id')}")
            if not Path(row.get("artifacts", {}).get("result", "")).is_file():
                errors.append(f"missing_result_artifact:{row.get('observation_id')}")
            if row.get("status") == "success" and validate_result(
                definition["operation"], definition.get("target"), _replay_result(row)
            ):
                errors.append(f"semantic_validation:{row.get('observation_id')}")
    raw_summary = summarize(rows)
    if json.loads((run_dir / "summary.json").read_text()) != raw_summary:
        errors.append("raw_summary_incongruent")
    return {
        "audit": "PASS" if not errors else "FAIL",
        "errors": errors,
        "run_id": manifest.get("run_id"),
        "terminal_count": len(rows),
        "raw_summary": raw_summary,
        "failure_retained_count": sum(
            row["status"] in {"failure", "timeout", "invalid"} for row in rows
        ),
    }


def _csv_bytes(rows: list[dict[str, Any]]) -> bytes:
    fields = sorted({key for row in rows for key in row}) or ["scenario"]
    stream = io.StringIO(newline="")
    writer = csv.DictWriter(stream, fields, lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    return stream.getvalue().encode()


def _report_artifacts(
    rows: list[dict[str, Any]], raw_summary: dict[str, Any]
) -> dict[str, bytes]:
    """Pure raw-only report rendering used twice for congruence verification."""
    latency, phase, frames, states = [], [], [], []
    for scenario in sorted({row["scenario"] for row in rows}):
        successful = [
            row
            for row in rows
            if row["scenario"] == scenario and row["status"] == "success"
        ]
        latency.append(
            {
                "scenario": scenario,
                **(
                    summary(
                        [
                            row["timing"]["settle_latency_ms"]["value_ms"]
                            for row in successful
                        ]
                    )
                    or {}
                ),
            }
        )
        for name in (
            "event_to_request_ms",
            "browser_http_ms",
            "response_to_snapshot_ms",
            "event_to_snapshot_ms",
            "snapshot_to_settle_ms",
        ):
            phase.append(
                {
                    "scenario": scenario,
                    "phase": name,
                    **(
                        summary(
                            [
                                row["timing"][name]["value_ms"]
                                for row in successful
                                if row["timing"][name]["state"] == "available"
                            ]
                        )
                        or {}
                    ),
                }
            )
        for name in ("baseline_frames", "operation_frames"):
            frames.append(
                {
                    "scenario": scenario,
                    "sample": name,
                    **(
                        summary(
                            [
                                row[name]["statistics"]["median_ms"]
                                for row in successful
                                if row[name]["statistics"].get("median_ms") is not None
                            ]
                        )
                        or {}
                    ),
                }
            )
        for row in successful:
            states.append(
                {
                    "scenario": scenario,
                    "observation_id": row["observation_id"],
                    **{
                        f"pre_{key}": value
                        for key, value in row["state"]["pre_operation"].items()
                    },
                    **{
                        f"post_{key}": value
                        for key, value in row["state"]["post_operation"].items()
                    },
                }
            )
    return {
        "rq4-summary.json": (
            json.dumps(raw_summary, indent=2, sort_keys=True) + "\n"
        ).encode(),
        "rq4-latency-summary.csv": _csv_bytes(latency),
        "rq4-phase-summary.csv": _csv_bytes(phase),
        "rq4-frame-summary.csv": _csv_bytes(frames),
        "rq4-state-cardinality.csv": _csv_bytes(states),
    }


def generate(run_dir: Path, output_dir: Path) -> dict[str, Any]:
    result = audit(run_dir)
    if result["audit"] != "PASS":
        raise ValueError("RQ4 audit failed; reports were not generated.")
    if output_dir.exists():
        raise ValueError(f"Derived output directory already exists: {output_dir}")
    rows = _rows(run_dir)
    artifacts = _report_artifacts(rows, result["raw_summary"])
    report_congruent = artifacts == _report_artifacts(rows, result["raw_summary"])
    if not report_congruent:
        raise ValueError("RQ4 deterministic report rendering was incongruent.")
    output_dir.mkdir(parents=True)
    for filename, content in artifacts.items():
        (output_dir / filename).write_bytes(content)
    write_json(
        output_dir / "rq4-provenance.json",
        {
            "manifest": json.loads((run_dir / "manifest.json").read_text()),
            "master": json.loads((run_dir / "master-provenance.json").read_text()),
        },
    )
    result["report_files"] = {
        path.name: _digest(path)
        for path in sorted(output_dir.iterdir())
        if path.is_file()
    }
    result["report_congruent"] = report_congruent
    write_json(output_dir / "rq4-final-audit.json", result)
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["audit", "generate"])
    parser.add_argument("--run-dir", required=True, type=Path)
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--development", action="store_true")
    args = parser.parse_args()
    result = (
        generate(args.run_dir, args.output_dir)
        if args.command == "generate"
        else audit(args.run_dir, require_final=not args.development)
    )
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    main()
