"""Deterministic raw-only reporting and audit for the final RQ2 microbenchmark."""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
from pathlib import Path
from typing import Any

from .common import validate_rq2_final_observation
from .rq2_final import (
    EXPERIMENT_ID,
    FINAL_RUN_ID_PATTERN,
    PRODUCT_RELEASE_COMMIT,
    PRODUCT_RELEASE_VERSION,
    _validate_final_experiment,
    summarize_final_observations,
)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Audit or generate final RQ2 derived artifacts."
    )
    subparsers = parser.add_subparsers(dest="command", required=True)
    for name in ("audit", "generate"):
        command = subparsers.add_parser(name)
        command.add_argument("--run-dir", type=Path, required=True)
        if name == "generate":
            command.add_argument("--output-dir", type=Path, required=True)
            command.add_argument("--reporting-audit-commit", required=True)
    args = parser.parse_args()
    audit = audit_run(args.run_dir)
    if args.command == "audit":
        print(json.dumps(audit, indent=2, sort_keys=True))
        return
    if not audit["pass"]:
        raise SystemExit(
            "Final RQ2 audit failed; derived artifacts were not generated."
        )
    generate(args.run_dir, args.output_dir, args.reporting_audit_commit, audit)
    print(args.output_dir)


def audit_run(run_dir: Path) -> dict[str, Any]:
    errors: list[str] = []
    manifest = _read_json(run_dir / "manifest.json", errors)
    config = _read_json(run_dir / "resolved-config.json", errors)
    observations = _read_jsonl(run_dir / "observations.jsonl", errors)
    raw_summary = _read_json(run_dir / "summary.json", errors)
    if not manifest or not config:
        return _audit(False, errors, run_dir, observations)
    try:
        _validate_final_experiment(config)
    except ValueError as error:
        errors.append(str(error))
    if manifest.get("state") != "completed":
        errors.append("Manifest state is not completed.")
    run_id = manifest.get("run_id")
    if not isinstance(run_id, str) or not FINAL_RUN_ID_PATTERN.fullmatch(run_id):
        errors.append("Final audit requires a thesis-final-rq2-v020-NNN run ID.")
    if manifest.get("experiment_id") != EXPERIMENT_ID:
        errors.append("Manifest experiment ID is not final RQ2.")
    if manifest.get("product") != {
        "version": PRODUCT_RELEASE_VERSION,
        "release_commit": PRODUCT_RELEASE_COMMIT,
        "source_diff_empty": True,
    }:
        errors.append("Manifest does not prove frozen product-source isolation.")
    if manifest.get("expected_terminal_observations") != 42:
        errors.append("Manifest expected terminal observation count is not 42.")
    if len(observations) != 42 or manifest.get("observed_terminal_observations") != 42:
        errors.append("Observed terminal observation count is not 42.")
    if manifest.get("policy", {}).get("retries") != 0:
        errors.append("Retry policy is not zero.")
    if manifest.get("policy", {}).get("global_prepared_node_count") != 100000:
        errors.append("Synthetic global prepared-node count is not the frozen 100000.")
    if manifest.get("policy", {}).get("max_nodes") != 100000:
        errors.append("maxNodes is not the frozen 100000.")
    if manifest.get("browser") != config.get("browser"):
        errors.append("Manifest browser policy differs from resolved configuration.")
    by_condition: dict[str, list[dict]] = {}
    seen_ids: set[tuple[str, str]] = set()
    for row in observations:
        _validate_row(row, config, seen_ids, by_condition, errors)
    expected_ids = [item["id"] for item in config.get("fixtures", [])]
    if sorted(by_condition) != sorted(expected_ids):
        errors.append("Observed condition IDs differ from frozen matrix.")
    for condition_id in expected_ids:
        rows = by_condition.get(condition_id, [])
        if (
            len(rows) != 6
            or sum(row.get("role") == "warmup" for row in rows) != 1
            or sum(row.get("role") == "measured" for row in rows) != 5
        ):
            errors.append(
                f"{condition_id} does not retain exactly one warm-up and five measured observations."
            )
        checksums = {row.get("fixture", {}).get("sha256") for row in rows}
        if len(checksums) != 1:
            errors.append(f"{condition_id} fixture SHA differs between repetitions.")
    if raw_summary != summarize_final_observations(observations):
        errors.append(
            "Raw summary is not congruent with retained terminal observations."
        )
    return _audit(not errors, errors, run_dir, observations)


def _validate_row(
    row: dict,
    config: dict,
    seen_ids: set[tuple[str, str]],
    by_condition: dict[str, list[dict]],
    errors: list[str],
) -> None:
    try:
        validate_rq2_final_observation(row)
    except ValueError as error:
        errors.append(f"Observation schema validation failed: {error}")
    condition = row.get("condition", {})
    fixture = row.get("fixture", {})
    condition_id = condition.get("id")
    key = (str(condition_id), str(row.get("observation_id")))
    if key in seen_ids:
        errors.append(f"Duplicate terminal observation {key}.")
    seen_ids.add(key)
    if not isinstance(condition_id, str):
        errors.append("Observation has no condition ID.")
        return
    by_condition.setdefault(condition_id, []).append(row)
    configured = next(
        (item for item in config.get("fixtures", []) if item["id"] == condition_id),
        None,
    )
    if configured is None:
        errors.append(f"Unknown condition {condition_id}.")
        return
    expected = configured["expected_primitive_count"]
    if (
        condition.get("global_prepared_node_count") != 100000
        or condition.get("max_nodes") != 100000
    ):
        errors.append(f"{condition_id} has non-frozen global count or maxNodes.")
    if any(
        fixture.get(key) != configured[key]
        for key in ("id", "node_count", "triangle_count", "expected_primitive_count")
    ):
        errors.append(f"{condition_id} fixture cardinality differs from frozen matrix.")
    if (
        fixture.get("edge_count") != configured["node_count"] - 1
        or fixture.get("expected_primitive_count") != expected
    ):
        errors.append(f"{condition_id} has inconsistent edge or primitive cardinality.")
    if fixture.get("mutated") is not False:
        errors.append(f"{condition_id} fixture mutation was observed.")
    if row.get("browser", {}).get("fresh_process") is not True:
        errors.append(f"{condition_id} does not record a fresh Chromium process.")
    if row.get("status") == "success":
        if row.get("gpu", {}).get("hardware_accelerated") is not True:
            errors.append(
                f"{condition_id} successful observation lacks hardware GPU evidence."
            )
        if row.get("replay", {}).get("truncated") is not False:
            errors.append(f"{condition_id} successful observation is truncated.")
        if not row.get("replay", {}).get("request_pattern_valid"):
            errors.append(
                f"{condition_id} successful observation has invalid request pattern."
            )
        if (
            row.get("replay", {}).get("viewport_request_count") != 1
            or row.get("replay", {}).get("post_initial_viewport_request_count") != 0
        ):
            errors.append(
                f"{condition_id} successful observation violates the frozen viewport request pattern."
            )
        if not row.get("snapshot", {}).get("fixture_congruent") or not row.get(
            "replay", {}
        ).get("response_cardinality_valid"):
            errors.append(
                f"{condition_id} successful observation lacks fixture/snapshot congruence."
            )
        if row.get("timing", {}).get("client_first_visualization_ms") is None:
            errors.append(
                f"{condition_id} successful observation lacks primary timing."
            )


def generate(
    run_dir: Path,
    output_dir: Path,
    reporting_audit_commit: str,
    audit: dict | None = None,
) -> None:
    audit = audit or audit_run(run_dir)
    if not audit["pass"]:
        raise ValueError(
            "Cannot generate derived RQ2 artifacts from an audit-failing raw run."
        )
    if output_dir.exists():
        raise ValueError(f"Derived output directory already exists: {output_dir}")
    output_dir.mkdir(parents=True)
    reports = build_reports(run_dir, reporting_audit_commit, audit)
    second = build_reports(run_dir, reporting_audit_commit, audit)
    if reports != second:
        raise ValueError("RQ2 derived reports are not deterministic in-memory.")
    for name, content in reports.items():
        (output_dir / name).write_bytes(content)
    hashes = {
        name: hashlib.sha256(content).hexdigest() for name, content in reports.items()
    }
    final_audit = {
        **audit,
        "report_congruent": True,
        "derived_sha256": hashes,
        "reporting_audit_commit": reporting_audit_commit,
    }
    (output_dir / "rq2-final-audit.json").write_text(
        _json_bytes(final_audit).decode("utf-8"), encoding="utf-8"
    )


def build_reports(
    run_dir: Path, reporting_audit_commit: str, audit: dict
) -> dict[str, bytes]:
    manifest = json.loads((run_dir / "manifest.json").read_text(encoding="utf-8"))
    observations = [
        json.loads(line)
        for line in (run_dir / "observations.jsonl")
        .read_text(encoding="utf-8")
        .splitlines()
        if line
    ]
    summary = summarize_final_observations(observations)
    measured = [
        row
        for row in observations
        if row["role"] == "measured" and row["status"] == "success"
    ]
    provenance = {
        "run_id": manifest["run_id"],
        "experiment_id": manifest["experiment_id"],
        "scientific_scope": manifest["scientific_scope"],
        "policy": manifest["policy"],
        "browser": manifest["browser"],
        "environment": manifest["environment"],
        "product": manifest["product"],
        "observed_browser_versions": manifest["observed_browser_versions"],
        "observed_playwright_versions": manifest["observed_playwright_versions"],
        "reporting_audit_commit": reporting_audit_commit,
        "fixture_sha256": manifest["fixture_sha256"],
    }
    reports = {
        "rq2-summary.json": _json_bytes(summary),
        "rq2-first-visualization.csv": _csv_bytes(_timing_rows(measured)),
        "rq2-memory.csv": _csv_bytes(_memory_rows(measured)),
        "rq2-frame-pacing.csv": _csv_bytes(_frame_rows(measured)),
        "rq2-provenance.json": _json_bytes(provenance),
        "rq2-first-visualization.svg": _latency_svg(measured),
    }
    if measured and all(row["rss"]["state"] == "available" for row in measured):
        reports["rq2-memory.svg"] = _memory_svg(measured)
    return reports


def _timing_rows(rows: list[dict]) -> list[dict[str, Any]]:
    fields = ("client_first_visualization_ms", "load_resolve_ms", "post_load_frame_ms")
    return [
        {
            "condition_id": row["condition"]["id"],
            "family": row["condition"]["family"],
            "primitive_count": row["fixture"]["expected_primitive_count"],
            "observation_id": row["observation_id"],
            **{field: row["timing"][field] for field in fields},
        }
        for row in rows
    ]


def _memory_rows(rows: list[dict]) -> list[dict[str, Any]]:
    output = []
    for row in rows:
        heap = row["heap"].get("delta", {}).get("js_heap_used_bytes", {})
        output.append(
            {
                "condition_id": row["condition"]["id"],
                "family": row["condition"]["family"],
                "primitive_count": row["fixture"]["expected_primitive_count"],
                "observation_id": row["observation_id"],
                "js_heap_delta_bytes": heap.get("bytes"),
                "process_tree_rss_state": row["rss"]["state"],
                "process_tree_peak_rss_bytes": row["rss"]["peak_rss_bytes"],
            }
        )
    return output


def _frame_rows(rows: list[dict]) -> list[dict[str, Any]]:
    return [
        {
            "condition_id": row["condition"]["id"],
            "family": row["condition"]["family"],
            "primitive_count": row["fixture"]["expected_primitive_count"],
            "observation_id": row["observation_id"],
            **row["frame_statistics"],
        }
        for row in rows
    ]


def _latency_svg(rows: list[dict]) -> bytes:
    width, height, margin = 760, 440, 54
    points = []
    max_x = max((row["fixture"]["expected_primitive_count"] for row in rows), default=1)
    max_y = max(
        (row["timing"]["client_first_visualization_ms"] or 0 for row in rows), default=1
    )
    for row in sorted(
        rows,
        key=lambda item: (
            item["fixture"]["expected_primitive_count"],
            item["observation_id"],
        ),
    ):
        x = (
            margin
            + (width - 2 * margin) * row["fixture"]["expected_primitive_count"] / max_x
        )
        y = (
            height
            - margin
            - (height - 2 * margin)
            * (row["timing"]["client_first_visualization_ms"] or 0)
            / max_y
        )
        color = "#2563eb" if row["condition"]["family"] == "detail" else "#b45309"
        points.append(f'<circle cx="{x:.3f}" cy="{y:.3f}" r="3" fill="{color}"/>')
    content = "".join(points)
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}"><rect width="100%" height="100%" fill="white"/><path d="M {margin} {margin} V {height - margin} H {width - margin}" stroke="black" fill="none"/><text x="{margin}" y="24" font-family="sans-serif" font-size="16">RQ2 client first-visualization interval</text><text x="{width / 2:.0f}" y="{height - 12}" text-anchor="middle" font-family="sans-serif" font-size="12">materialized primitives</text><text x="14" y="{height / 2:.0f}" transform="rotate(-90 14 {height / 2:.0f})" text-anchor="middle" font-family="sans-serif" font-size="12">milliseconds</text>{content}<circle cx="{width - 190}" cy="28" r="4" fill="#2563eb"/><text x="{width - 180}" y="32" font-family="sans-serif" font-size="11">DETAIL</text><circle cx="{width - 110}" cy="28" r="4" fill="#b45309"/><text x="{width - 100}" y="32" font-family="sans-serif" font-size="11">TRIANGLE</text></svg>'.encode(
        "utf-8"
    )


def _memory_svg(rows: list[dict]) -> bytes:
    width, height, margin = 760, 440, 54
    max_x = max(row["fixture"]["expected_primitive_count"] for row in rows)
    max_y = max(row["rss"]["peak_rss_bytes"] for row in rows)
    points = []
    for row in sorted(
        rows,
        key=lambda item: (
            item["fixture"]["expected_primitive_count"],
            item["observation_id"],
        ),
    ):
        x = (
            margin
            + (width - 2 * margin) * row["fixture"]["expected_primitive_count"] / max_x
        )
        y = (
            height
            - margin
            - (height - 2 * margin) * row["rss"]["peak_rss_bytes"] / max_y
        )
        color = "#2563eb" if row["condition"]["family"] == "detail" else "#b45309"
        points.append(f'<circle cx="{x:.3f}" cy="{y:.3f}" r="3" fill="{color}"/>')
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}"><rect width="100%" height="100%" fill="white"/><path d="M {margin} {margin} V {height - margin} H {width - margin}" stroke="black" fill="none"/><text x="{margin}" y="24" font-family="sans-serif" font-size="16">RQ2 process-tree peak RSS</text><text x="{width / 2:.0f}" y="{height - 12}" text-anchor="middle" font-family="sans-serif" font-size="12">materialized primitives</text><text x="14" y="{height / 2:.0f}" transform="rotate(-90 14 {height / 2:.0f})" text-anchor="middle" font-family="sans-serif" font-size="12">bytes</text>{"".join(points)}</svg>'.encode(
        "utf-8"
    )


def _csv_bytes(rows: list[dict[str, Any]]) -> bytes:
    fieldnames = sorted({key for row in rows for key in row})
    stream = io.StringIO(newline="")
    writer = csv.DictWriter(stream, fieldnames=fieldnames, lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    return stream.getvalue().encode("utf-8")


def _json_bytes(payload: Any) -> bytes:
    return (json.dumps(payload, indent=2, sort_keys=True) + "\n").encode("utf-8")


def _read_json(path: Path, errors: list[str]) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        errors.append(f"Could not read {path.name}: {error}")
        return {}


def _read_jsonl(path: Path, errors: list[str]) -> list[dict]:
    try:
        return [
            json.loads(line)
            for line in path.read_text(encoding="utf-8").splitlines()
            if line
        ]
    except (OSError, json.JSONDecodeError) as error:
        errors.append(f"Could not read observations.jsonl: {error}")
        return []


def _audit(
    passed: bool, errors: list[str], run_dir: Path, observations: list[dict]
) -> dict:
    return {
        "schema_version": "1",
        "audit": "rq2-final",
        "run_dir": str(run_dir.resolve()),
        "pass": passed,
        "errors": errors,
        "terminal_observations": len(observations),
        "success_count": sum(row.get("status") == "success" for row in observations),
        "failure_count": sum(row.get("status") == "failure" for row in observations),
        "timeout_count": sum(row.get("status") == "timeout" for row in observations),
        "invalid_count": sum(row.get("status") == "invalid" for row in observations),
    }


if __name__ == "__main__":
    main()
