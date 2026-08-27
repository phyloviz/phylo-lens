"""Build a raw/derived-only master inventory of closed final evaluations.

This module deliberately does not run an experiment or regenerate any study
report.  It normalizes numerical result tables from retained authoritative
artifacts and records the exact artifact paths and SHA-256 values used.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import shutil
import subprocess
from collections import defaultdict
from pathlib import Path
from typing import Any

from .stats import summary

PRODUCT_COMMIT = "cbb78f5e74b37e4fb480c0416e614e27e6f67ed9"


def repository_root() -> Path:
    return Path(__file__).resolve().parents[3]


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text().splitlines() if line]


def digest(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            hasher.update(block)
    return hasher.hexdigest()


def relative(root: Path, path: Path | None) -> str | None:
    if path is None:
        return None
    try:
        return str(path.relative_to(root))
    except ValueError:
        # The combined external comparison is retained by the Thesis project,
        # rather than copied into this repository.  Preserve its absolute path
        # instead of misclassifying the evidence as missing.
        return str(path)


def artifact(root: Path, path: Path | None) -> dict[str, str] | None:
    if path is None or not path.is_file():
        return None
    return {"path": relative(root, path) or str(path), "sha256": digest(path)}


def write_json(path: Path, payload: Any) -> None:
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n")


def write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    fields = sorted({key for row in rows for key in row}) or ["study"]
    with path.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def copy_csv(source: Path, destination: Path) -> list[dict[str, str]]:
    rows = list(csv.DictReader(source.open(encoding="utf-8", newline="")))
    write_csv(destination, rows)
    return rows


def statistic_columns(
    prefix: str, values: list[float]
) -> dict[str, float | int | None]:
    stats = summary(values) or {}
    return {
        f"{prefix}_{key}": stats.get(key)
        for key in ("count", "median", "p25", "p75", "iqr")
    }


def rq1_results(root: Path, raw: Path) -> list[dict[str, Any]]:
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in read_jsonl(raw / "observations.jsonl"):
        groups[row["condition_id"]].append(row)
    output = []
    for condition_id, rows in sorted(groups.items()):
        first = rows[0]
        measured = [row for row in rows if row["phase"] == "measured"]
        successful = [row for row in measured if row["status"] == "success"]
        preparation = [row["timing"]["preparation_wall_ms"] for row in successful]
        rss = [row["memory"]["peak_rss_bytes"] for row in successful]
        output.append(
            {
                "condition_id": condition_id,
                "topology": first["topology"],
                "requested_leaves": first["requested_leaves"],
                "seed": first["seed"],
                "parsed_nodes": first["parsed_nodes"],
                "parsed_edges": first["parsed_edges"],
                "warmup_count": sum(row["phase"] == "warmup" for row in rows),
                "measured_count": len(measured),
                "success_count": len(successful),
                "failure_count": sum(row["status"] == "failure" for row in measured),
                "timeout_count": sum(row["status"] == "timeout" for row in measured),
                "invalid_count": sum(row["status"] == "invalid" for row in measured),
                "memory_scope": first["memory"]["scope"],
                **statistic_columns("preparation_ms", preparation),
                **statistic_columns("peak_rss_bytes", rss),
            }
        )
    return output


def grouped_csv_statistics(
    source: Path, *, group: tuple[str, ...], metrics: tuple[str, ...]
) -> list[dict[str, Any]]:
    groups: dict[tuple[str, ...], list[dict[str, str]]] = defaultdict(list)
    for row in csv.DictReader(source.open(encoding="utf-8", newline="")):
        groups[tuple(row[key] for key in group)].append(row)
    output = []
    for key, rows in sorted(groups.items()):
        item: dict[str, Any] = dict(zip(group, key, strict=True))
        item["observation_count"] = len(rows)
        for metric in metrics:
            values = [
                float(row[metric]) for row in rows if row.get(metric) not in (None, "")
            ]
            item.update(statistic_columns(metric, values))
        output.append(item)
    return output


def rq4_results(root: Path, raw: Path, derived: Path) -> list[dict[str, Any]]:
    latency = {
        row["scenario"]: row
        for row in csv.DictReader((derived / "rq4-latency-summary.csv").open())
    }
    phases: dict[str, dict[str, dict[str, str]]] = defaultdict(dict)
    for row in csv.DictReader((derived / "rq4-phase-summary.csv").open()):
        phases[row["scenario"]][row["phase"]] = row
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in read_jsonl(raw / "observations.jsonl"):
        groups[row["scenario"]].append(row)
    output = []
    for scenario, rows in sorted(groups.items()):
        first = rows[0]
        item: dict[str, Any] = {
            "scenario": scenario,
            "operation": first["observer"]["after"]["boundary"]["reason"],
            "represented_member_count": (first.get("target") or {}).get(
                "represented_member_count"
            ),
            "pre_materialized_nodes": first["state"]["pre_operation"][
                "materialized_nodes"
            ],
            "pre_materialized_edges": first["state"]["pre_operation"][
                "materialized_edges"
            ],
            "post_materialized_nodes": first["state"]["post_operation"][
                "materialized_nodes"
            ],
            "post_materialized_edges": first["state"]["post_operation"][
                "materialized_edges"
            ],
            "success_count": sum(row["status"] == "success" for row in rows),
            "failure_count": sum(row["status"] == "failure" for row in rows),
            "timeout_count": sum(row["status"] == "timeout" for row in rows),
            "invalid_count": sum(row["status"] == "invalid" for row in rows),
            "measured_request_count": sum(
                len(row["requests"]["relevant"]) for row in rows
            ),
            "truncated_response_count": sum(
                item["truncated"]
                for row in rows
                for item in row["requests"]["response_metadata"]
            ),
        }
        for prefix, values in (("settle_latency_ms", latency[scenario]),):
            for stat in ("count", "median", "p25", "p75", "iqr"):
                item[f"{prefix}_{stat}"] = values.get(stat) or None
        for phase, values in phases[scenario].items():
            for stat in ("count", "median", "p25", "p75", "iqr"):
                item[f"{phase}_{stat}"] = values.get(stat) or None
        output.append(item)
    return output


def git_output(root: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", *args], cwd=root, check=True, capture_output=True, text=True
    )
    return result.stdout.strip()


def verify_reconciled_git_history(root: Path) -> None:
    """Confirm recovered commit provenance from local immutable Git history."""
    checks = (
        (
            "b97f98588e7398f60cc9b0637e8b8abf58b409d6",
            "b51504aa256cbd0052ebe43fd35d03b5a612ec1c",
            {"eval/src/phylo_lens_eval/rq1_final_audit.py"},
        ),
        (
            "6479542144689d27e057a7333919653130f92222",
            "8f82a42c66e1501f76608401f1bc4ccec010a768",
            {
                "eval/src/phylo_lens_eval/rq4_final_audit.py",
                "eval/tests/test_rq4_final.py",
            },
        ),
        (
            "2a4e7ce80af9d72ff95c883a2633bae6e8d0191a",
            "00dd1bfd876000ddca87c085676e711cee2f11ed",
            {
                "eval/src/phylo_lens_eval/msagl_baseline_audit.py",
                "eval/tests/test_msagl_baseline_audit.py",
            },
        ),
    )
    for execution, reporting, expected_paths in checks:
        git_output(root, "rev-parse", "--verify", f"{execution}^{{commit}}")
        git_output(root, "rev-parse", "--verify", f"{reporting}^{{commit}}")
        if subprocess.run(
            ["git", "merge-base", "--is-ancestor", execution, reporting],
            cwd=root,
            check=False,
        ).returncode:
            raise ValueError(
                f"Reporting commit does not follow execution commit: {reporting}"
            )
        changed = set(
            git_output(root, "show", "--format=", "--name-only", reporting).splitlines()
        )
        if changed != expected_paths:
            raise ValueError(
                f"Unexpected reporting-commit scope for {reporting}: {changed}"
            )
        if git_output(
            root,
            "diff",
            "--name-only",
            execution,
            reporting,
            "--",
            "code/server",
            "code/client",
        ):
            raise ValueError(
                f"Product source changed between recovered commits: {reporting}"
            )


def verify_external_comparison(root: Path) -> dict[str, Any]:
    """Validate the retained cross-system table against its source observations.

    The combined report intentionally draws PhyloLens from the v0.2.0
    replacement run and Phylotree.js/Taxonium from the original native run.
    This verification prevents the consolidation from treating the combined
    table as an untraceable external input.
    """
    thesis = root.parent / "Thesis"
    combined = (
        thesis
        / "results/derived/final-external-fullmst-combined-v020"
        / "thesis-final-fullmst-combined-v020-004"
    )
    original_raw = (
        thesis / "results/raw/final/final-external-fullmst" / "thesis-final-fullmst-001"
    )
    replacement_raw = (
        thesis
        / "results/raw/final/final-external-fullmst-phylolens-0.2.0"
        / "thesis-final-fullmst-phylolens-v020-004"
    )
    audit_path = combined / "combined-final-audit.json"
    summary_path = combined / "combined-external-summary.json"
    timing_path = combined / "combined-external-timing-summary.csv"
    outcomes_path = combined / "combined-external-success-failure-scaling.csv"
    topology_path = combined / "combined-external-topology-identity-status.csv"
    required = (
        audit_path,
        summary_path,
        timing_path,
        outcomes_path,
        topology_path,
        original_raw / "observations",
        replacement_raw / "observations",
    )
    if any(not path.exists() for path in required):
        missing = [str(path) for path in required if not path.exists()]
        raise FileNotFoundError(
            f"External-comparison evidence is incomplete: {missing}"
        )

    audit, combined_summary = read_json(audit_path), read_json(summary_path)
    if audit.get("status") != "passed" or audit.get("report_congruent") is not True:
        raise ValueError("Combined external-comparison audit did not pass congruence")
    if audit.get("original_run", {}).get("run_id") != "thesis-final-fullmst-001":
        raise ValueError(
            "Combined external-comparison original source run is unexpected"
        )
    if (
        audit.get("replacement_run_audit", {}).get("run_id")
        != "thesis-final-fullmst-phylolens-v020-004"
    ):
        raise ValueError(
            "Combined external-comparison replacement source run is unexpected"
        )

    expected_source = {
        "phylolens": replacement_raw,
        "phylotree": original_raw,
        "taxonium": original_raw,
    }
    source_rows: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    all_source_rows: list[dict[str, Any]] = []
    for tool_id, source_root in expected_source.items():
        for path in sorted((source_root / "observations").glob("*.json")):
            row = read_json(path)
            if row.get("tool_id") != tool_id:
                continue
            all_source_rows.append(row)
            if row.get("phase") == "measured" and row.get("status") == "success":
                source_rows[(tool_id, row["dataset_id"])].append(row)

    reported_timings = {
        (row["tool_id"], row["dataset_id"]): row
        for row in csv.DictReader(timing_path.open(encoding="utf-8", newline=""))
    }
    reported_outcomes = {
        (row["tool_id"], row["dataset_id"]): row
        for row in csv.DictReader(outcomes_path.open(encoding="utf-8", newline=""))
    }
    matrix = {
        (row["tool_id"], row["dataset_id"]): row for row in combined_summary["matrix"]
    }
    expected_keys = set(source_rows)
    if not (
        len(expected_keys)
        == 30
        == len(reported_timings)
        == len(reported_outcomes)
        == len(matrix)
    ):
        raise ValueError(
            "External-comparison matrix does not contain 30 tool/dataset rows"
        )
    if (
        set(reported_timings) != expected_keys
        or set(reported_outcomes) != expected_keys
        or set(matrix) != expected_keys
    ):
        raise ValueError(
            "External-comparison tables do not match source observation keys"
        )

    for key, observations in source_rows.items():
        tool_id, _ = key
        metrics = summary(
            [float(row["time_to_first_visual_output_ms"]) for row in observations]
        )
        assert metrics is not None
        timing, outcome, matrix_row = (
            reported_timings[key],
            reported_outcomes[key],
            matrix[key],
        )
        if len(observations) != 3 or int(timing["successful_count"]) != 3:
            raise ValueError(f"External-comparison measured count mismatch for {key}")
        for report_name, metric_name in (
            ("median_ms", "median"),
            ("p25_ms", "p25"),
            ("p75_ms", "p75"),
            ("iqr_ms", "iqr"),
        ):
            if not math.isclose(
                float(timing[report_name]), float(metrics[metric_name]), abs_tol=1e-9
            ):
                raise ValueError(
                    f"External-comparison {report_name} mismatch for {key}"
                )
        for row in (timing, outcome, matrix_row):
            if row["source_run_dir"] != str(expected_source[tool_id]):
                raise ValueError(f"External-comparison source path mismatch for {key}")
        if any(
            int(row[field]) != 0
            for row in (outcome, matrix_row)
            for field in ("failure_count", "timeout_count")
        ):
            raise ValueError(f"External-comparison outcome mismatch for {key}")
        if int(outcome["measured_count"]) != 3 or int(outcome["warmup_count"]) != 1:
            raise ValueError(f"External-comparison repetition mismatch for {key}")

    if any(row.get("status") != "success" for row in all_source_rows):
        raise ValueError(
            "External-comparison selected source observations are not all successful"
        )
    return {
        "combined": combined,
        "original_raw": original_raw,
        "replacement_raw": replacement_raw,
        "audit": audit,
        "summary": combined_summary,
        "artifacts": [
            audit_path,
            summary_path,
            timing_path,
            outcomes_path,
            topology_path,
        ],
        "matrix_rows": len(expected_keys),
        "selected_terminal_observations": len(all_source_rows),
        "selected_warmups": sum(row["phase"] == "warmup" for row in all_source_rows),
        "selected_measured": sum(row["phase"] == "measured" for row in all_source_rows),
    }


def index_record(
    *,
    study: str,
    purpose: str,
    status: str,
    run_id: str,
    raw: Path | None,
    derived: Path | None,
    product_commit: str | None,
    execution_harness_commit: str | None,
    reporting_audit_commit: str | None,
    provenance: dict[str, Any],
    dataset: dict[str, Any] | None,
    layout: dict[str, Any] | None,
    repetitions: dict[str, Any] | None,
    counts: dict[str, Any] | None,
    retry_policy: Any,
    audit_result: str | None,
    report_congruent: bool | None,
    primary_metrics: list[str],
    secondary_metrics: list[str],
    interpretation_constraints: list[str],
    missing_provenance: list[str],
    predecessors: list[dict[str, str]],
    artifacts: list[Path],
    root: Path,
    source_raw_directories: list[Path] | None = None,
) -> dict[str, Any]:
    return {
        "study": study,
        "scientific_purpose": purpose,
        "authoritative_status": status,
        "authoritative_run_id": run_id,
        "raw_directory": relative(root, raw),
        "source_raw_directories": [
            relative(root, path) for path in (source_raw_directories or [])
        ],
        "derived_directory": relative(root, derived),
        "product_commit": product_commit,
        "execution_harness_commit": execution_harness_commit,
        "reporting_audit_commit": reporting_audit_commit,
        "dataset": dataset,
        "layout": layout,
        "hardware_browser_runtime_provenance": provenance,
        "repetitions": repetitions,
        "terminal_outcomes": counts,
        "retry_policy": retry_policy,
        "audit_result": audit_result,
        "report_congruent": report_congruent,
        "primary_metrics": primary_metrics,
        "secondary_metrics": secondary_metrics,
        "interpretation_constraints": interpretation_constraints,
        "missing_provenance": missing_provenance,
        "predecessors": predecessors,
        "source_artifacts": [
            artifact(root, path) for path in artifacts if path.is_file()
        ],
    }


def build(root: Path, output: Path, *, replace: bool = False) -> list[Path]:
    if output.exists():
        if not replace:
            raise FileExistsError(
                f"Refusing to replace existing consolidated output: {output}"
            )
        shutil.rmtree(output)
    output.mkdir(parents=True)
    verify_reconciled_git_history(root)
    raw_root, derived_root = root / "eval/results/raw", root / "eval/results/derived"
    rq1_raw = raw_root / "rq1-final-oci-v020/thesis-final-rq1-v020-002"
    rq1_derived = derived_root / "rq1-final-oci-v020/thesis-final-rq1-v020-002"
    rq2_raw = raw_root / "rq2-client-final-v020/thesis-final-rq2-v020-001"
    rq2_derived = derived_root / "rq2-client-final-v020/thesis-final-rq2-v020-001"
    rq3_raw = raw_root / "rq3-lod-final-v020/thesis-final-rq3-v020-002"
    rq3_derived = derived_root / "rq3-lod-final-v020/thesis-final-rq3-v020-002"
    rq4_raw = raw_root / "rq4-interactive-final-v020/thesis-final-rq4-v020-003"
    rq4_derived = derived_root / "rq4-interactive-final-v020/thesis-final-rq4-v020-003"
    msagl_raw = raw_root / "rq5-msagljs-current-mds-v001/thesis-msagljs-mds-v001-001"
    msagl_derived = (
        derived_root / "rq5-msagljs-current-mds-v001/thesis-msagljs-mds-v001-001"
    )
    external = verify_external_comparison(root)

    rq1_manifest, rq1_audit = (
        read_json(rq1_raw / "manifest.json"),
        read_json(rq1_derived / "rq1-final-audit.json"),
    )
    rq2_manifest, rq2_audit = (
        read_json(rq2_raw / "manifest.json"),
        read_json(rq2_derived / "rq2-final-audit.json"),
    )
    rq3_manifest, rq3_audit = (
        read_json(rq3_raw / "manifest.json"),
        read_json(rq3_derived / "rq3-final-audit.json"),
    )
    rq4_manifest, rq4_audit = (
        read_json(rq4_raw / "manifest.json"),
        read_json(rq4_derived / "rq4-final-audit.json"),
    )
    msagl_manifest, msagl_audit = (
        read_json(msagl_raw / "manifest.json"),
        read_json(msagl_derived / "msagljs-final-audit.json"),
    )

    generated: list[Path] = []
    tables: dict[str, list[dict[str, Any]]] = {
        "rq1-condition-metrics.csv": rq1_results(root, rq1_raw),
        "rq2-first-visualization-summary.csv": grouped_csv_statistics(
            rq2_derived / "rq2-first-visualization.csv",
            group=("condition_id", "family", "primitive_count"),
            metrics=(
                "client_first_visualization_ms",
                "load_resolve_ms",
                "post_load_frame_ms",
            ),
        ),
        "rq2-memory-summary.csv": grouped_csv_statistics(
            rq2_derived / "rq2-memory.csv",
            group=("condition_id", "family", "primitive_count"),
            metrics=("js_heap_delta_bytes",),
        ),
        "rq2-frame-summary.csv": grouped_csv_statistics(
            rq2_derived / "rq2-frame-pacing.csv",
            group=("condition_id", "family", "primitive_count"),
            metrics=("median_ms", "p95_ms", "maximum_ms", "above_50_ms_count"),
        ),
        "rq4-condition-metrics.csv": rq4_results(root, rq4_raw, rq4_derived),
    }
    for filename, rows in tables.items():
        path = output / filename
        write_csv(path, rows)
        generated.append(path)
    for filename, source in {
        "rq3-lod-reduction.csv": rq3_derived / "rq3-lod-reduction.csv",
        "msagljs-condition-metrics.csv": msagl_derived / "msagljs-timing-summary.csv",
        "msagljs-success-failure.csv": msagl_derived
        / "msagljs-success-failure-summary.csv",
        "phylolens-vs-msagljs-descriptive-comparison.csv": msagl_derived
        / "phylolens-vs-msagljs-native-preparation.csv",
    }.items():
        copy_csv(source, output / filename)
        generated.append(output / filename)
    for filename, source in {
        "external-comparison-first-meaningful-visual.csv": external["combined"]
        / "combined-external-timing-summary.csv",
        "external-comparison-success-failure.csv": external["combined"]
        / "combined-external-success-failure-scaling.csv",
        "external-comparison-topology-identity-status.csv": external["combined"]
        / "combined-external-topology-identity-status.csv",
    }.items():
        copy_csv(source, output / filename)
        generated.append(output / filename)
    semantic = {
        "source_artifacts": {
            name: artifact(root, rq3_derived / name)
            for name in (
                "rq3-membership-validation.json",
                "rq3-position-validation.json",
                "rq3-quotient-connectivity.json",
            )
        },
        "membership": read_json(rq3_derived / "rq3-membership-validation.json"),
        "positions": read_json(rq3_derived / "rq3-position-validation.json"),
        "quotient_connectivity": read_json(
            rq3_derived / "rq3-quotient-connectivity.json"
        ),
    }
    write_json(output / "rq3-semantic-fidelity.json", semantic)
    generated.append(output / "rq3-semantic-fidelity.json")
    external_provenance = {
        "validation": "Recomputed 30 timing summaries from 90 successful measured source observations and matched the retained combined table exactly.",
        "combined_audit": external["audit"],
        "source_raw_directories": [
            str(external["original_raw"]),
            str(external["replacement_raw"]),
        ],
        "source_artifacts": [artifact(root, path) for path in external["artifacts"]],
    }
    write_json(output / "external-comparison-provenance.json", external_provenance)
    generated.append(output / "external-comparison-provenance.json")

    records = [
        index_record(
            study="RQ1",
            purpose="Server-side layout preparation time and verified recursive process-tree peak RSS across synthetic topology/size conditions.",
            status="authoritative",
            run_id=rq1_manifest["run_id"],
            raw=rq1_raw,
            derived=rq1_derived,
            product_commit=rq1_manifest["provenance"]["product_release_commit"],
            execution_harness_commit=rq1_manifest["provenance"][
                "evaluation_harness_commit"
            ],
            reporting_audit_commit="b51504aa256cbd0052ebe43fd35d03b5a612ec1c",
            provenance={
                "host": rq1_manifest["provenance"]["host"],
                "docker_version": rq1_manifest["provenance"]["docker_version"],
                "oci_index_reference": rq1_manifest["provenance"][
                    "oci_index_reference"
                ],
                "reporting_audit_commit_recovery": {
                    "commit": "b51504aa256cbd0052ebe43fd35d03b5a612ec1c",
                    "evidence": "Git commit subject ‘Audit immutable final RQ1 run ID sequence’; changed only eval/src/phylo_lens_eval/rq1_final_audit.py and follows the manifest-recorded execution harness commit.",
                },
            },
            dataset={"conditions": rq1_manifest["provenance"]["verified_conditions"]},
            layout=None,
            repetitions={"warmups_per_condition": 1, "measured_per_condition": 5},
            counts={
                "terminal": 90,
                "success": 89,
                "failure": 1,
                "timeout": 0,
                "invalid": 0,
            },
            retry_policy=0,
            audit_result=rq1_audit["status"],
            report_congruent=rq1_audit["report_congruent"],
            primary_metrics=["preparation_wall_ms", "process_tree_peak_rss_bytes"],
            secondary_metrics=[
                "SFDP observed",
                "READY status",
                "input topology/node/edge identity",
            ],
            interpretation_constraints=[
                "Warm-ups are retained but excluded from value statistics.",
                "The retained single caterpillar-50000 measured failure is counted but excluded from value statistics.",
            ],
            missing_provenance=[],
            predecessors=[
                {
                    "run_id": "thesis-final-rq1-v020-001",
                    "status": "incomplete",
                    "reason": "external interruption with no harness-level failure evidence",
                }
            ],
            artifacts=[
                rq1_raw / "manifest.json",
                rq1_raw / "summary.json",
                rq1_derived / "rq1-final-audit.json",
                rq1_derived / "rq1-final-timing-memory.csv",
            ],
            root=root,
        ),
        index_record(
            study="RQ2",
            purpose="Isolated client materialized visual working-set first-visualization latency, JavaScript heap delta, and frame pacing.",
            status="authoritative",
            run_id=rq2_manifest["run_id"],
            raw=rq2_raw,
            derived=rq2_derived,
            product_commit=rq2_manifest["product"]["release_commit"],
            execution_harness_commit=rq2_manifest["environment"]["git"]["commit"],
            reporting_audit_commit=rq2_audit["reporting_audit_commit"],
            provenance={
                "environment": rq2_manifest["environment"],
                "browser": rq2_manifest["browser"],
                "observed_browser_versions": rq2_manifest["observed_browser_versions"],
                "observed_playwright_versions": rq2_manifest[
                    "observed_playwright_versions"
                ],
            },
            dataset={
                "fixtures": rq2_manifest["fixtures"],
                "fixture_sha256": rq2_manifest["fixture_sha256"],
            },
            layout=None,
            repetitions={"warmups_per_condition": 1, "measured_per_condition": 5},
            counts={
                "terminal": rq2_audit["terminal_observations"],
                "success": rq2_audit["success_count"],
                "failure": rq2_audit["failure_count"],
                "timeout": rq2_audit["timeout_count"],
                "invalid": rq2_audit["invalid_count"],
            },
            retry_policy=rq2_manifest["policy"]["retries"],
            audit_result="PASS" if rq2_audit["pass"] else "FAIL",
            report_congruent=rq2_audit["report_congruent"],
            primary_metrics=["client_first_visualization_ms", "js_heap_delta_bytes"],
            secondary_metrics=["frame pacing", "materialized primitive count"],
            interpretation_constraints=[
                "Isolated client microbenchmark; it is not an end-to-end server/layout benchmark.",
                "Browser startup is outside the primary timing boundary.",
            ],
            missing_provenance=[],
            predecessors=[],
            artifacts=[
                rq2_raw / "manifest.json",
                rq2_raw / "summary.json",
                rq2_derived / "rq2-final-audit.json",
                rq2_derived / "rq2-first-visualization.csv",
                rq2_derived / "rq2-memory.csv",
                rq2_derived / "rq2-frame-pacing.csv",
            ],
            root=root,
        ),
        index_record(
            study="RQ3",
            purpose="Persisted hierarchical LoD materialization reduction with exact source-node membership, representative-position, and quotient-connectivity fidelity.",
            status="authoritative",
            run_id=rq3_manifest["run_id"],
            raw=rq3_raw,
            derived=rq3_derived,
            product_commit=rq3_manifest["product"]["release_commit"],
            execution_harness_commit=rq3_manifest["environment"]["git"]["commit"],
            reporting_audit_commit=rq3_audit["reporting_audit_commit"],
            provenance={
                "environment": rq3_manifest["environment"],
                "integrity_reconciliation": {
                    "sealing_implementation_commit": "2a9b07a42b4bb698009ca9931a34a5860ac48336",
                    "sealed_sqlite_sha256": rq3_manifest["layout"]["database_sha256"],
                    "semantic_artifact_sha256": rq3_audit["derived_sha256"],
                    "disposition": "Physical sealed SQLite and all semantic-validation artifacts were rehashed against the retained audit ledger; historical dirty-worktree status is retained unchanged.",
                },
            },
            dataset=rq3_manifest["source"],
            layout=rq3_manifest["layout"],
            repetitions={"terminal_cases": 3},
            counts={
                "terminal": rq3_manifest["observed_terminal_cases"],
                "success": rq3_manifest["success_count"],
                "failure": rq3_manifest["failure_count"],
                "timeout": 0,
                "invalid": rq3_manifest["invalid_count"],
            },
            retry_policy=rq3_manifest["policy"]["retries"],
            audit_result="PASS" if rq3_audit["pass"] else "FAIL",
            report_congruent=rq3_audit["report_congruent"],
            primary_metrics=[
                "materialization_ratio",
                "node_reduction_factor",
                "primitive_reduction_ratio",
            ],
            secondary_metrics=[
                "canonical serialized representation bytes",
                "visual nodes/edges",
                "represented source nodes",
            ],
            interpretation_constraints=[
                "This is a deterministic structural/fidelity evaluation, not a browser latency benchmark.",
                "Execution manifest records a dirty evaluation worktree; the exact commit and audit remain recorded.",
            ],
            missing_provenance=[],
            predecessors=[
                {
                    "run_id": "thesis-final-rq3-v020-001",
                    "status": "superseded",
                    "reason": "superseded for publication by authoritative sealed-master v002",
                }
            ],
            artifacts=[
                rq3_raw / "manifest.json",
                rq3_raw / "summary.json",
                rq3_derived / "rq3-final-audit.json",
                rq3_derived / "rq3-lod-reduction.csv",
                rq3_derived / "rq3-membership-validation.json",
                rq3_derived / "rq3-position-validation.json",
                rq3_derived / "rq3-quotient-connectivity.json",
            ],
            root=root,
        ),
        index_record(
            study="RQ4",
            purpose="Browser-observed interaction settle latency, phase decomposition, state transitions, and frame pacing after persisted layout preparation and public bootstrap.",
            status="authoritative",
            run_id=rq4_manifest["run_id"],
            raw=rq4_raw,
            derived=rq4_derived,
            product_commit=PRODUCT_COMMIT,
            execution_harness_commit=rq4_manifest["git"]["commit"],
            reporting_audit_commit="8f82a42c66e1501f76608401f1bc4ccec010a768",
            provenance={
                "environment": rq4_manifest["environment"],
                "browser": rq4_manifest["rq4"]["browser"],
                "reporting_audit_commit_recovery": {
                    "commit": "8f82a42c66e1501f76608401f1bc4ccec010a768",
                    "evidence": "Git commit subject ‘test(eval): pin corrected RQ4 execution harness’; changed only RQ4 audit/test files, is after the manifest-recorded execution harness, and has no product-source or raw-v003 paths.",
                },
            },
            dataset=rq4_manifest["dataset"],
            layout=rq4_manifest["authoritative_master"],
            repetitions={"warmups_per_condition": 0, "measured_per_condition": 7},
            counts={
                "terminal": rq4_audit["terminal_count"],
                **{
                    key.removesuffix("_count"): value
                    for key, value in rq4_audit["raw_summary"].items()
                    if key.endswith("_count")
                },
            },
            retry_policy=0,
            audit_result=rq4_audit["audit"],
            report_congruent=rq4_audit["report_congruent"],
            primary_metrics=["settle_latency_ms", "phase decomposition"],
            secondary_metrics=[
                "pre/post materialized cardinalities",
                "truncation",
                "frame diagnostics",
            ],
            interpretation_constraints=[
                "Timing boundary is trusted capture-phase browser input event through second post-snapshot animation frame.",
                "v002 is not publication evidence because collapse timing instrumentation timestamped after synchronous snapshot application.",
            ],
            missing_provenance=[],
            predecessors=[
                {
                    "run_id": "thesis-final-rq4-v020-001",
                    "status": "incomplete",
                    "reason": "infrastructure failure",
                },
                {
                    "run_id": "thesis-final-rq4-v020-002",
                    "status": "superseded",
                    "reason": "evaluation timing-boundary defect",
                },
            ],
            artifacts=[
                rq4_raw / "manifest.json",
                rq4_raw / "summary.json",
                rq4_derived / "rq4-final-audit.json",
                rq4_derived / "rq4-latency-summary.csv",
                rq4_derived / "rq4-phase-summary.csv",
                rq4_derived / "rq4-state-cardinality.csv",
                rq4_derived / "rq4-frame-summary.csv",
            ],
            root=root,
        ),
        index_record(
            study="MSAGLJS architectural baseline",
            purpose="Current-source native MSAGLJS MDS + Sleeve + TileMap preparation-to-browsable-state baseline.",
            status="authoritative",
            run_id=msagl_manifest["run_id"],
            raw=msagl_raw,
            derived=msagl_derived,
            product_commit=None,
            execution_harness_commit="2a4e7ce80af9d72ff95c883a2633bae6e8d0191a",
            reporting_audit_commit="00dd1bfd876000ddca87c085676e711cee2f11ed",
            provenance={
                **msagl_manifest["provenance"],
                "commit_recovery": {
                    "execution_harness": {
                        "commit": "2a4e7ce80af9d72ff95c883a2633bae6e8d0191a",
                        "evidence": "Git commit subject ‘Harden MSAGLJS baseline execution evidence’; changed the native runner, execution harness, and execution tests.",
                    },
                    "reporting_audit": {
                        "commit": "00dd1bfd876000ddca87c085676e711cee2f11ed",
                        "evidence": "Git commit subject ‘Add MSAGLJS raw report and final audit’; changed only the MSAGLJS audit implementation and its tests after the execution harness commit.",
                    },
                },
            },
            dataset={
                "per-condition source/adapted SHA-256": "retained in observations.jsonl and msagljs-provenance.json"
            },
            layout={
                "native_path": msagl_manifest["provenance"]["native_path"],
                "tile_map": msagl_manifest["provenance"]["tile_map"],
            },
            repetitions=msagl_manifest["provenance"]["repetition_policy"],
            counts={"terminal": msagl_audit["observed_terminal_observations"]},
            retry_policy=msagl_manifest["provenance"]["repetition_policy"][
                "retries_permitted"
            ],
            audit_result=msagl_audit["status"],
            report_congruent=msagl_audit["report_congruent"],
            primary_metrics=[
                "total_ms",
                "parse_ms",
                "geometry_ms",
                "layout_ms",
                "routing_ms",
                "tiling_ms",
                "actual tile levels",
            ],
            secondary_metrics=[
                "matching descriptive PhyloLens native preparation comparison"
            ],
            interpretation_constraints=[
                "Current MDS path; it is not a reproduction of the manuscript IPSep-CoLa loading table.",
                "Cross-system comparison is descriptive native preparation-to-browsable-state only, not equivalent layout throughput.",
            ],
            missing_provenance=[
                "PhyloLens product commit is not applicable/recorded for the independent MSAGLJS run.",
            ],
            predecessors=[],
            artifacts=[
                msagl_raw / "manifest.json",
                msagl_derived / "msagljs-final-audit.json",
                msagl_derived / "msagljs-timing-summary.csv",
                msagl_derived / "msagljs-success-failure-summary.csv",
                msagl_derived / "phylolens-vs-msagljs-native-preparation.csv",
            ],
            root=root,
        ),
        index_record(
            study="External comparison",
            purpose="Final first-meaningful-visual comparison across systems and sizes.",
            status="authoritative",
            run_id="thesis-final-fullmst-combined-v020-004",
            raw=None,
            derived=external["combined"],
            product_commit=None,
            execution_harness_commit=None,
            reporting_audit_commit=None,
            provenance={
                "combined_audit": artifact(
                    root, external["combined"] / "combined-final-audit.json"
                ),
                "source_run_policy": external["audit"]["replacement_policy"],
            },
            dataset={
                "original_tree_sha256": external["audit"]["original_run"][
                    "tree_sha256"
                ],
                "replacement_phylolens_tree_sha256": external["audit"][
                    "phylolens_replacement_run"
                ]["tree_sha256"],
            },
            layout=None,
            repetitions={"warmups_per_condition": 1, "measured_per_condition": 3},
            counts={
                "terminal": external["selected_terminal_observations"],
                "warmup": external["selected_warmups"],
                "measured": external["selected_measured"],
                "success": external["selected_measured"],
                "failure": 0,
                "timeout": 0,
                "invalid": 0,
            },
            retry_policy=None,
            audit_result="PASS",
            report_congruent=True,
            primary_metrics=["first_meaningful_visual"],
            secondary_metrics=["success/failure/timeout scaling outcomes"],
            interpretation_constraints=[
                "PhyloLens rows are from the v0.2.0 replacement run; Phylotree.js and Taxonium rows are from the original native run.",
                "Topology/identity observability differs by system; consult external-comparison-topology-identity-status.csv for eligibility caveats.",
            ],
            missing_provenance=[],
            predecessors=[],
            artifacts=external["artifacts"],
            root=root,
            source_raw_directories=[
                external["original_raw"],
                external["replacement_raw"],
            ],
        ),
    ]
    index = {
        "schema_version": "1",
        "frozen_product": {"version": "0.2.0", "commit": PRODUCT_COMMIT},
        "studies": records,
    }
    write_json(output / "master-evidence-index.json", index)
    generated.append(output / "master-evidence-index.json")
    write_csv(
        output / "master-evidence-index.csv",
        [
            {
                key: json.dumps(value, sort_keys=True)
                if isinstance(value, (dict, list))
                else value
                for key, value in record.items()
            }
            for record in records
        ],
    )
    generated.append(output / "master-evidence-index.csv")
    plan = {
        "main_text_tables": [
            {
                "id": "T1",
                "sources": ["RQ1"],
                "type": "condition summary",
                "columns": [
                    "topology",
                    "requested_leaves",
                    "parsed_nodes",
                    "success_count/measured_count",
                    "preparation_ms median/P25/P75/IQR",
                    "peak_rss_bytes median/P25/P75/IQR",
                ],
                "question": "How does preparation time and memory scale by topology and size?",
                "non_redundancy": "One compact table preserves all 15 factorial conditions and the retained failure count.",
            },
            {
                "id": "T2",
                "sources": ["RQ3"],
                "type": "LoD reduction/fidelity summary",
                "columns": [
                    "lod_level",
                    "visual nodes/edges",
                    "represented source nodes",
                    "materialization ratio",
                    "node reduction factor",
                    "primitive reduction ratio",
                    "canonical representation bytes",
                    "semantic checks",
                ],
                "question": "How much materialization reduction is achieved while retaining exact semantics?",
                "non_redundancy": "Combines the three deterministic levels and their validation results.",
            },
            {
                "id": "T3",
                "sources": ["RQ4"],
                "type": "interaction latency/phase summary",
                "columns": [
                    "scenario",
                    "n",
                    "settle median/P25/P75/IQR",
                    "phase medians",
                    "pre/post cardinalities",
                    "truncation",
                ],
                "question": "What latency does each user-visible interaction incur and where is time spent?",
                "non_redundancy": "Pairs total settle time with the operationally meaningful decomposition.",
            },
            {
                "id": "T4",
                "sources": ["MSAGLJS architectural baseline"],
                "type": "descriptive matching-condition comparison",
                "columns": [
                    "topology",
                    "requested_leaves",
                    "system",
                    "native preparation median/P25/P75/IQR",
                    "scope caveat",
                ],
                "question": "How does the current-source MDS baseline compare descriptively at matching conditions?",
                "non_redundancy": "Makes the architecture caveat inseparable from the numbers.",
            },
        ],
        "main_text_figures": [
            {
                "id": "F1",
                "sources": ["RQ1"],
                "type": "two-panel log-scale line/point plot",
                "x": "requested_leaves",
                "y": ["preparation_ms", "peak_rss_bytes"],
                "grouping": "topology",
                "units": ["ms", "bytes or GiB"],
                "question": "Scaling sensitivity to size and topology.",
                "non_redundancy": "Shows trends obscured by T1 while retaining the same authoritative values.",
            },
            {
                "id": "F2",
                "sources": ["RQ3"],
                "type": "grouped bar chart",
                "x": "lod_level",
                "y": "materialization_ratio or visual_primitives/full_detail_primitives",
                "grouping": "metric",
                "units": "ratio",
                "question": "Reduction across persisted LoD levels.",
                "non_redundancy": "Visualizes the central compression result; exact values remain in T2.",
            },
            {
                "id": "F3",
                "sources": ["RQ2"],
                "type": "point-range plot",
                "x": "primitive_count",
                "y": "client_first_visualization_ms",
                "grouping": "fixture family",
                "units": "ms",
                "question": "Client responsiveness across materialized workload.",
                "non_redundancy": "Separates detail and triangle controls without duplicating memory diagnostics.",
            },
            {
                "id": "F4",
                "sources": ["RQ4"],
                "type": "horizontal point-range plot",
                "x": "settle_latency_ms",
                "y": "scenario",
                "grouping": "operation",
                "units": "ms",
                "question": "Interactive latency by action.",
                "non_redundancy": "Directly answers the RQ4 user-facing result; phase detail remains in T3.",
            },
        ],
        "appendix_only": [
            {
                "artifact": "RQ1 full condition/checksum/provenance inventory",
                "reason": "Audit traceability rather than a primary result.",
            },
            {
                "artifact": "RQ2 heap and frame-pacing tables",
                "reason": "Secondary diagnostics supporting the latency figure.",
            },
            {
                "artifact": "RQ3 membership, position, and quotient-connectivity validation payloads",
                "reason": "Exact semantic-fidelity evidence is too detailed for main text.",
            },
            {
                "artifact": "RQ4 complete phase, frame, fingerprint, and request/truncation inventory",
                "reason": "Supports measurement interpretation without duplicating T3/F4.",
            },
            {
                "artifact": "MSAGLJS per-stage timing and adapted-graph provenance",
                "reason": "Necessary audit detail and architectural caveat support.",
            },
        ],
    }
    write_json(output / "figure-table-plan.json", plan)
    generated.append(output / "figure-table-plan.json")
    return generated


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Consolidate closed final evaluation evidence."
    )
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument(
        "--replace",
        action="store_true",
        help="replace an existing consolidated derived directory (never raw evidence)",
    )
    args = parser.parse_args()
    root = repository_root()
    output = args.output_dir or root / "eval/results/derived/consolidated-final-v020"
    for path in build(root, output.resolve(), replace=args.replace):
        print(path)


if __name__ == "__main__":
    main()
