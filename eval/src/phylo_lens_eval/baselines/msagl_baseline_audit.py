"""Deterministic raw-only reporting and audit for the MSAGLJS MDS study."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from ..core.common import write_json
from .msagl_baseline import (
    NATIVE_MAX_MEMORY_BYTES,
    TILE_CAPACITY,
    TILE_LEVEL_UPPER_BOUND,
    TIMEOUT_SECONDS,
    UPSTREAM_COMMIT,
    adapt_newick,
    repository_root,
    selected_conditions,
)
from ..core.stats import summary

EXECUTION_HARNESS_COMMIT = "2a4e7ce80af9d72ff95c883a2633bae6e8d0191a"
YARN_LOCK_SHA256 = "ac84ae8de6bcbbf407a8a85592c8f1bcfa1758f7f24c3a0d33428db72b71b06e"
NATIVE_PATH = "MdsLayoutSettings+layoutGraphWithMds+Sleeve+TileMap.buildUpToLevel"
PRODUCT_RELEASE_COMMIT = "cbb78f5e74b37e4fb480c0416e614e27e6f67ed9"
RQ1_RUN_ID = "thesis-final-rq1-v020-002"
TIMING_FIELDS = (
    "total_ms",
    "parse_ms",
    "geometry_ms",
    "layout_ms",
    "cdt_ms",
    "routing_ms",
    "tiling_ms",
    "other_ms",
)
FLOAT_TOLERANCE_MS = 0.1


class MSAuditError(ValueError):
    """A raw campaign cannot be reported or audited as requested."""


def _json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _rows(run_dir: Path) -> list[dict[str, Any]]:
    path = run_dir / "observations.jsonl"
    if not path.is_file():
        raise MSAuditError(f"missing observations stream: {path}")
    return [
        json.loads(line)
        for line in path.read_text(encoding="utf-8").splitlines()
        if line
    ]


def _phase(row: dict[str, Any]) -> str:
    if row.get("warmup") is True:
        return "warmup"
    observation_id = str(row.get("observation_id", ""))
    if observation_id.startswith("measured-"):
        return "measured"
    if observation_id.startswith("smoke-"):
        return "smoke"
    return "unknown"


def _stat(values: list[float]) -> dict[str, Any] | None:
    return summary([float(value) for value in values])


def _condition_identity(condition_id: str) -> dict[str, Any]:
    """Decode the frozen condition identity from its retained raw directory ID."""
    parts = condition_id.split("-")
    if len(parts) < 2 or parts[0] not in {"balanced", "irregular", "caterpillar"}:
        raise MSAuditError(f"unsupported raw condition ID: {condition_id}")
    try:
        requested_leaves = int(parts[1])
    except ValueError as error:
        raise MSAuditError(f"unsupported raw condition ID: {condition_id}") from error
    seed = int(parts[3]) if parts[0] == "irregular" and parts[2:3] == ["seed"] else None
    return {
        "requested_leaves": requested_leaves,
        "topology": parts[0],
        "seed": seed,
    }


def raw_summary(
    rows: list[dict[str, Any]],
    *,
    value_phases: tuple[str, ...] = ("measured",),
    expected_value_count: int = 5,
) -> dict[str, Any]:
    """Project raw observations into deterministic, condition-separated statistics."""
    groups = []
    for condition_id in sorted({str(row["condition_id"]) for row in rows}):
        items = [row for row in rows if row["condition_id"] == condition_id]
        identity = _condition_identity(condition_id)
        measured = [row for row in items if _phase(row) in value_phases]
        successful = [row for row in measured if row.get("state") == "success"]
        first = items[0]
        native = [row["native"] for row in successful]
        metrics = {
            field: _stat(
                [
                    value[field]
                    for value in native
                    if isinstance(value.get(field), (int, float))
                ]
            )
            for field in TIMING_FIELDS
        }
        levels = [
            value["actual_levels_built"]
            for value in native
            if isinstance(value.get("actual_levels_built"), int)
        ]
        groups.append(
            {
                "condition_id": condition_id,
                "requested_leaves": identity["requested_leaves"],
                "parsed_nodes": first["node_count"],
                "parsed_edges": first["edge_count"],
                "topology": identity["topology"],
                "seed": identity["seed"],
                "expected_measured_count": expected_value_count,
                "observed_measured_count": len(measured),
                "measured_successes": len(successful),
                "measured_failures": sum(
                    row.get("state") == "failure" for row in measured
                ),
                "measured_timeouts": sum(
                    row.get("state") == "timeout" for row in measured
                ),
                "warmup_count": sum(_phase(row) == "warmup" for row in items),
                "metrics_ms": metrics,
                "actual_tile_levels": _stat(levels),
            }
        )
    return {
        "schema_version": "1",
        "value_population": f"successful {'/'.join(value_phases)} observations only",
        "groups": groups,
    }


def _conditions() -> dict[str, dict[str, Any]]:
    return {item["id"]: item for item in selected_conditions(repository_root())}


def _rq1_rows(run_dir: Path) -> list[dict[str, Any]]:
    return [
        row
        for row in _rows(run_dir)
        if row.get("phase") == "measured" and row.get("status") == "success"
    ]


def comparison_rows(
    msagl_summary: dict[str, Any], rq1_run_dir: Path
) -> list[dict[str, Any]]:
    """Join only exact topology/leaves/nodes matches; never pool topologies."""
    rq1_groups: dict[tuple[str, int, int], list[float]] = {}
    for row in _rq1_rows(rq1_run_dir):
        key = (row["topology"], row["requested_leaves"], row["parsed_nodes"])
        rq1_groups.setdefault(key, []).append(
            float(row["timing"]["preparation_wall_ms"])
        )
    output = []
    for group in msagl_summary["groups"]:
        key = (group["topology"], group["requested_leaves"], group["parsed_nodes"])
        if key not in rq1_groups:
            raise MSAuditError(f"no matching final RQ1 condition for {key}")
        msagl = group["metrics_ms"]["total_ms"]
        if msagl is None:
            raise MSAuditError(f"no successful MSAGLJS measured values for {key}")
        phylolens = _stat(rq1_groups[key])
        for system, values in (("PhyloLens", phylolens), ("MSAGLJS", msagl)):
            output.append(
                {
                    "topology": key[0],
                    "requested_leaves": key[1],
                    "parsed_nodes": key[2],
                    "system": system,
                    "measured_successes": values["count"],
                    "expected_measured": 5,
                    "native_preparation_median_ms": values["median"],
                    "native_preparation_p25_ms": values["p25"],
                    "native_preparation_p75_ms": values["p75"],
                    "native_preparation_iqr_ms": values["iqr"],
                    "comparison_scope": "native preparation-to-browsable-state; not equivalent layout throughput",
                }
            )
    return sorted(
        output,
        key=lambda row: (row["topology"], row["requested_leaves"], row["system"]),
    )


def _write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    fields = sorted({key for row in rows for key in row})
    with path.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def _timing_rows(summary_payload: dict[str, Any]) -> list[dict[str, Any]]:
    rows = []
    for group in summary_payload["groups"]:
        row = {
            key: group[key]
            for key in (
                "condition_id",
                "topology",
                "seed",
                "requested_leaves",
                "parsed_nodes",
                "parsed_edges",
                "expected_measured_count",
                "observed_measured_count",
                "measured_successes",
            )
        }
        for metric, values in group["metrics_ms"].items():
            for statistic in ("median", "p25", "p75", "iqr"):
                row[f"{metric}_{statistic}"] = values.get(statistic) if values else None
        levels = group["actual_tile_levels"]
        row["actual_tile_levels_median"] = levels.get("median") if levels else None
        row["actual_tile_levels_minimum"] = levels.get("minimum") if levels else None
        row["actual_tile_levels_maximum"] = levels.get("maximum") if levels else None
        rows.append(row)
    return rows


def _outcome_rows(summary_payload: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        {
            key: group[key]
            for key in (
                "condition_id",
                "topology",
                "requested_leaves",
                "parsed_nodes",
                "parsed_edges",
                "expected_measured_count",
                "observed_measured_count",
                "measured_successes",
                "measured_failures",
                "measured_timeouts",
                "warmup_count",
            )
        }
        for group in summary_payload["groups"]
    ]


def _svg(rows: list[dict[str, Any]]) -> str:
    """A deliberately plain, deterministic comparison table in SVG form."""
    height = 86 + 24 * len(rows)
    text = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="{height}" viewBox="0 0 1100 {height}">',
        '<rect width="100%" height="100%" fill="white"/>',
        '<text x="20" y="28" font-family="sans-serif" font-size="16">Native preparation-to-browsable-state (different internal workloads)</text>',
        '<text x="20" y="54" font-family="monospace" font-size="12">topology / leaves / nodes                         system       median ms</text>',
    ]
    for index, row in enumerate(rows):
        y = 78 + index * 24
        label = f"{row['topology']:<11} {row['requested_leaves']:>6} {row['parsed_nodes']:>7}"
        value = f"{row['native_preparation_median_ms']:.3f}"
        text.append(
            f'<text x="20" y="{y}" font-family="monospace" font-size="12">{label}   {row["system"]:<10} {value}</text>'
        )
    text.append("</svg>")
    return "\n".join(text) + "\n"


def provenance_payload(
    manifest: dict[str, Any], rows: list[dict[str, Any]], reporting_audit_commit: str
) -> dict[str, Any]:
    native = [row["native"] for row in rows if row.get("state") == "success"]
    return {
        "schema_version": "1",
        "execution_harness_commit": EXECUTION_HARNESS_COMMIT,
        "reporting_audit_implementation_commit": reporting_audit_commit,
        "msagljs_commit": manifest["provenance"]["msagljs_commit"],
        "yarn_lock_sha256": manifest["provenance"]["yarn_lock_sha256"],
        "host": manifest["provenance"]["host"],
        "outer_deadline_seconds": manifest["provenance"]["timeout_seconds"],
        "browser_lifecycle": manifest["provenance"]["browser_lifecycle"],
        "tile_map": manifest["provenance"]["tile_map"],
        "tile_level_index_semantics": (
            "TileMap.buildUpToLevel(z) permits levels 0..z inclusive; the pinned "
            "example MAX_TILE_LEVELS=8 is a maximum level index (up to 9 levels), "
            "while this wrapper uses non-binding maximum level index 30 (up to 31 levels)."
        ),
        "timing_interpretation": (
            "total_ms is the browser-native parse-to-TileMap-ready wall interval; "
            "it is not the example script's published totalMs expression."
        ),
        "paper_vs_repository_discrepancy": manifest["provenance"]["paper_discrepancy"],
        "browser_observations": [
            {
                "observation_id": row["observation_id"],
                "browser": row["native"].get("browser"),
                "actual_levels_built": row["native"].get("actual_levels_built"),
                "source_sha256": row["source_sha256"],
                "adapted_sha256": row["adapted_sha256"],
            }
            for row in rows
            if row.get("state") == "success"
        ],
        "successful_observation_count": len(native),
    }


def write_report(
    run_dir: Path,
    output_dir: Path,
    *,
    rq1_run_dir: Path,
    reporting_audit_commit: str,
) -> dict[str, Path]:
    """Write deterministic derived artifacts; raw observations remain read-only."""
    manifest = _json(run_dir / "manifest.json")
    rows = _rows(run_dir)
    development = manifest.get("run_kind") == "development_smoke"
    payload = raw_summary(
        rows,
        value_phases=("smoke",) if development else ("measured",),
        expected_value_count=1 if development else 5,
    )
    comparison = comparison_rows(payload, rq1_run_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    paths = {
        "summary": output_dir / "msagljs-summary.json",
        "timing": output_dir / "msagljs-timing-summary.csv",
        "outcomes": output_dir / "msagljs-success-failure-summary.csv",
        "provenance": output_dir / "msagljs-provenance.json",
        "comparison": output_dir / "phylolens-vs-msagljs-native-preparation.csv",
        "comparison_svg": output_dir / "native-preparation-comparison.svg",
    }
    write_json(paths["summary"], payload)
    _write_csv(paths["timing"], _timing_rows(payload))
    _write_csv(paths["outcomes"], _outcome_rows(payload))
    write_json(
        paths["provenance"], provenance_payload(manifest, rows, reporting_audit_commit)
    )
    _write_csv(paths["comparison"], comparison)
    paths["comparison_svg"].write_text(_svg(comparison), encoding="utf-8")
    return paths


def _reason(reasons: list[dict[str, str]], code: str, detail: str) -> None:
    reasons.append({"code": code, "detail": detail})


def _check_artifacts(
    run_dir: Path,
    row: dict[str, Any],
    condition: dict[str, Any],
    reasons: list[dict[str, str]],
) -> None:
    directory = run_dir / "conditions" / row["condition_id"] / row["observation_id"]
    required = (
        "observation.json",
        "adaptation.json",
        "graph.tsv",
        "runner.stdout.txt",
        "runner.stderr.txt",
        "outer-watchdog.json",
    )
    if not all((directory / name).is_file() for name in required):
        _reason(reasons, "missing_artifact", row["observation_id"])
        return
    if _json(directory / "observation.json") != row:
        _reason(reasons, "observation_stream_mismatch", row["observation_id"])
    adaptation = _json(directory / "adaptation.json")
    graph = (directory / "graph.tsv").read_bytes()
    if (
        adaptation.get("source_sha256") != row.get("source_sha256")
        or adaptation.get("adapted_sha256") != row.get("adapted_sha256")
        or adaptation.get("node_count") != row.get("node_count")
        or adaptation.get("edge_count") != row.get("edge_count")
        or hashlib.sha256(graph).hexdigest() != row.get("adapted_sha256")
    ):
        _reason(reasons, "adapter_artifact_mismatch", row["observation_id"])
    try:
        expected = adapt_newick(Path(condition["absolute_path"]))
        if (
            expected["source_sha256"] != row.get("source_sha256")
            or expected["payload"] != graph
            or expected["node_count"] != row.get("node_count")
            or expected["edge_count"] != row.get("edge_count")
        ):
            _reason(reasons, "adapter_topology_proof_failed", row["observation_id"])
    except (OSError, UnicodeDecodeError, ValueError) as error:
        _reason(reasons, "adapter_topology_proof_unavailable", str(error))


def _check_success(row: dict[str, Any], reasons: list[dict[str, str]]) -> None:
    native = row.get("native", {})
    if native.get("native_path") != NATIVE_PATH:
        _reason(reasons, "native_path_observation", row["observation_id"])
    evidence = native.get("execution_evidence", {})
    if not (
        evidence.get("mds_layout_settings_constructed")
        and evidence.get("layout_graph_with_mds_called")
        and evidence.get("edge_routing_mode") == "Sleeve"
        and evidence.get("tile_map_build_completed")
    ):
        _reason(reasons, "native_execution_evidence", row["observation_id"])
    browser = native.get("browser", {})
    if browser.get("page_errors") != [] or browser.get("clean_exit") is not True:
        _reason(reasons, "browser_terminal_evidence", row["observation_id"])
    if any(not isinstance(native.get(field), (int, float)) for field in TIMING_FIELDS):
        _reason(reasons, "missing_timing", row["observation_id"])
        return
    if native["total_ms"] <= 0 or any(
        native[field] < 0 for field in TIMING_FIELDS if field != "total_ms"
    ):
        _reason(reasons, "invalid_timing", row["observation_id"])
    reconciliation = sum(
        native[field]
        for field in ("parse_ms", "geometry_ms", "layout_ms", "tiling_ms", "other_ms")
    )
    if abs(reconciliation - native["total_ms"]) > FLOAT_TOLERANCE_MS:
        _reason(reasons, "timing_reconciliation", row["observation_id"])
    if native.get("routing_phases_ms") != native.get("cdt_ms", 0) + native.get(
        "routing_ms", 0
    ):
        _reason(reasons, "routing_phase_reconciliation", row["observation_id"])
    levels = native.get("actual_levels_built")
    if not isinstance(levels, int) or not 1 <= levels <= TILE_LEVEL_UPPER_BOUND + 1:
        _reason(reasons, "tile_level_count", row["observation_id"])
    if native.get("tile_map_number_of_levels") != levels:
        _reason(reasons, "tile_level_native_mismatch", row["observation_id"])


def audit(
    run_dir: Path,
    *,
    mode: str = "final",
    derived_dir: Path | None = None,
    rq1_run_dir: Path | None = None,
    reporting_audit_commit: str = "unrecorded",
) -> dict[str, Any]:
    """Return machine-readable PASS/FAIL reasons without mutating raw evidence."""
    reasons: list[dict[str, str]] = []
    rq1_run_dir = (
        rq1_run_dir
        or repository_root() / "eval/results/raw/rq1-final-oci-v020" / RQ1_RUN_ID
    )
    try:
        manifest = _json(run_dir / "manifest.json")
        rows = _rows(run_dir)
    except (OSError, json.JSONDecodeError, MSAuditError) as error:
        return {
            "status": "FAIL",
            "reasons": [{"code": "raw_unreadable", "detail": str(error)}],
        }
    development = mode == "development"
    if mode not in {"final", "development"}:
        _reason(reasons, "invalid_mode", mode)
    if manifest.get("state") != "completed":
        _reason(reasons, "manifest_state", str(manifest.get("state")))
    expected_count = 1 if development else 54
    if (
        manifest.get("expected_raw_observations") != expected_count
        or len(rows) != expected_count
    ):
        _reason(
            reasons,
            "campaign_completeness",
            f"expected {expected_count}, observed {len(rows)}",
        )
    if development:
        if (
            not manifest.get("development_evidence_only")
            or manifest.get("run_kind") != "development_smoke"
        ):
            _reason(
                reasons,
                "development_label",
                "smoke run is not explicitly development-only",
            )
    elif (
        manifest.get("development_evidence_only")
        or manifest.get("run_kind") != "final_campaign"
    ):
        _reason(
            reasons,
            "smoke_contamination",
            "final audit rejects development-only evidence",
        )
    provenance = manifest.get("provenance", {})
    if provenance.get("msagljs_commit") != UPSTREAM_COMMIT:
        _reason(reasons, "upstream_sha", str(provenance.get("msagljs_commit")))
    if provenance.get("yarn_lock_sha256") != YARN_LOCK_SHA256:
        _reason(reasons, "lockfile_sha", str(provenance.get("yarn_lock_sha256")))
    if provenance.get("native_path") != NATIVE_PATH:
        _reason(reasons, "native_path", str(provenance.get("native_path")))
    if "IPSep-CoLa" not in str(
        provenance.get("paper_discrepancy", "")
    ) or "MDS" not in str(provenance.get("paper_discrepancy", "")):
        _reason(reasons, "paper_discrepancy", "missing IPSep-CoLa/MDS distinction")
    tile = provenance.get("tile_map", {})
    if tile.get("tile_capacity") != TILE_CAPACITY:
        _reason(reasons, "tile_capacity", str(tile.get("tile_capacity")))
    if tile.get("native_max_memory_bytes") != NATIVE_MAX_MEMORY_BYTES:
        _reason(reasons, "tile_memory_budget", str(tile.get("native_max_memory_bytes")))
    if tile.get("tile_level_upper_bound") != TILE_LEVEL_UPPER_BOUND:
        _reason(reasons, "tile_level_index", str(tile.get("tile_level_upper_bound")))
    if (
        provenance.get("timeout_seconds") != TIMEOUT_SECONDS
        or provenance.get("outer_watchdog", {}).get("deadline_seconds")
        != TIMEOUT_SECONDS
    ):
        _reason(reasons, "deadline", "outer deadline is not exactly 300 seconds")
    if "fresh Chromium process" not in str(provenance.get("browser_lifecycle", "")):
        _reason(reasons, "browser_lifecycle", "fresh browser lifecycle not recorded")
    policy = provenance.get("repetition_policy", {})
    if policy.get("retries_permitted") != 0:
        _reason(reasons, "retry_policy", str(policy.get("retries_permitted")))
    conditions = _conditions()
    expected_ids = {"balanced-5000"} if development else set(conditions)
    if {row.get("condition_id") for row in rows} != expected_ids:
        _reason(
            reasons, "condition_matrix", "condition identity differs from frozen matrix"
        )
    identifiers = [row.get("observation_id") for row in rows]
    if len(identifiers) != len(set(identifiers)):
        _reason(reasons, "duplicate_observation", "observation IDs are not unique")
    plan: dict[str, list[tuple[str, int]]] = {
        condition: [] for condition in expected_ids
    }
    for row in rows:
        condition = conditions.get(row.get("condition_id"))
        if not condition:
            continue
        if row.get("attempt_count") != 1 or row.get("retry_permitted") is not False:
            _reason(reasons, "retry_detected", str(row.get("observation_id")))
        if (
            row.get("node_count") != condition["parsed_nodes"]
            or row.get("edge_count") != condition["parsed_edges"]
        ):
            _reason(reasons, "node_edge_identity", str(row.get("observation_id")))
        phase = _phase(row)
        plan[row["condition_id"]].append((phase, row.get("repetition_index")))
        if row.get("state") not in {"success", "failure", "timeout"}:
            _reason(reasons, "terminal_classification", str(row.get("observation_id")))
        _check_artifacts(run_dir, row, condition, reasons)
        if row.get("state") == "success":
            _check_success(row, reasons)
        if row.get("state") == "timeout" and not row.get("outer_watchdog", {}).get(
            "timed_out"
        ):
            _reason(reasons, "timeout_watchdog", str(row.get("observation_id")))
    expected_plan = (
        [("smoke", 0)]
        if development
        else [("warmup", 0), *(("measured", index) for index in range(5))]
    )
    if any(sorted(value) != sorted(expected_plan) for value in plan.values()):
        _reason(
            reasons,
            "repetition_plan",
            "must retain 1 warm-up plus 5 measured per condition",
        )
    product_diff = subprocess.run(
        [
            "git",
            "diff",
            "--exit-code",
            f"{PRODUCT_RELEASE_COMMIT}..HEAD",
            "--",
            "code/server",
            "code/client",
        ],
        cwd=repository_root(),
        capture_output=True,
        text=True,
        check=False,
    )
    if product_diff.returncode:
        _reason(
            reasons, "product_source_diff", product_diff.stdout + product_diff.stderr
        )
    report_congruent = None
    if derived_dir is not None and not reasons:
        with tempfile.TemporaryDirectory() as temporary:
            generated = write_report(
                run_dir,
                Path(temporary),
                rq1_run_dir=rq1_run_dir,
                reporting_audit_commit=reporting_audit_commit,
            )
            report_congruent = all(
                (derived_dir / path.name).is_file()
                and (derived_dir / path.name).read_bytes() == path.read_bytes()
                for path in generated.values()
            )
        if not report_congruent:
            _reason(
                reasons,
                "report_congruence",
                "derived report is not byte-for-byte raw-only congruent",
            )
    result = {
        "status": "PASS" if not reasons else "FAIL",
        "mode": mode,
        "development_only": development,
        "run_id": manifest.get("run_id"),
        "observed_terminal_observations": len(rows),
        "reasons": reasons,
        "report_congruent": report_congruent,
    }
    audit_artifact = derived_dir / "msagljs-final-audit.json" if derived_dir else None
    if audit_artifact and audit_artifact.is_file():
        expected = json.dumps(result, indent=2, sort_keys=True) + "\n"
        if audit_artifact.read_text(encoding="utf-8") != expected:
            _reason(
                reasons,
                "audit_artifact_congruence",
                "stored audit is not the deterministic audit projection",
            )
            result["status"] = "FAIL"
    return result


def generate(
    run_dir: Path,
    output_dir: Path,
    *,
    mode: str,
    rq1_run_dir: Path,
    reporting_audit_commit: str,
) -> dict[str, Path]:
    paths = write_report(
        run_dir,
        output_dir,
        rq1_run_dir=rq1_run_dir,
        reporting_audit_commit=reporting_audit_commit,
    )
    report = audit(
        run_dir,
        mode=mode,
        derived_dir=output_dir,
        rq1_run_dir=rq1_run_dir,
        reporting_audit_commit=reporting_audit_commit,
    )
    audit_path = output_dir / "msagljs-final-audit.json"
    write_json(audit_path, report)
    return {**paths, "audit": audit_path}


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Report/audit the immutable MSAGLJS raw campaign."
    )
    parser.add_argument("action", choices=("report", "audit", "generate"))
    parser.add_argument("--run-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument(
        "--rq1-run-dir",
        type=Path,
        default=repository_root() / "eval/results/raw/rq1-final-oci-v020" / RQ1_RUN_ID,
    )
    parser.add_argument("--development", action="store_true")
    parser.add_argument("--reporting-audit-commit", default="unrecorded")
    args = parser.parse_args()
    mode = "development" if args.development else "final"
    if args.action in {"report", "generate"} and args.output_dir is None:
        parser.error(f"{args.action} requires --output-dir")
    if args.action == "report":
        print(
            json.dumps(
                {
                    key: str(value)
                    for key, value in write_report(
                        args.run_dir,
                        args.output_dir,
                        rq1_run_dir=args.rq1_run_dir,
                        reporting_audit_commit=args.reporting_audit_commit,
                    ).items()
                },
                indent=2,
                sort_keys=True,
            )
        )
    elif args.action == "generate":
        print(
            json.dumps(
                {
                    key: str(value)
                    for key, value in generate(
                        args.run_dir,
                        args.output_dir,
                        mode=mode,
                        rq1_run_dir=args.rq1_run_dir,
                        reporting_audit_commit=args.reporting_audit_commit,
                    ).items()
                },
                indent=2,
                sort_keys=True,
            )
        )
    else:
        print(
            json.dumps(
                audit(
                    args.run_dir,
                    mode=mode,
                    derived_dir=args.output_dir,
                    rq1_run_dir=args.rq1_run_dir,
                    reporting_audit_commit=args.reporting_audit_commit,
                ),
                indent=2,
                sort_keys=True,
            )
        )


if __name__ == "__main__":
    main()
