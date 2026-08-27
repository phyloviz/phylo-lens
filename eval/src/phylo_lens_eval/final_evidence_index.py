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
    return str(path.relative_to(root))


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
) -> dict[str, Any]:
    return {
        "study": study,
        "scientific_purpose": purpose,
        "authoritative_status": status,
        "authoritative_run_id": run_id,
        "raw_directory": relative(root, raw),
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


def build(root: Path, output: Path) -> list[Path]:
    if output.exists():
        raise FileExistsError(
            f"Refusing to replace existing consolidated output: {output}"
        )
    output.mkdir(parents=True)
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
    external_missing = {
        "requested_authoritative_run_id": "thesis-final-fullmst-combined-v020-004",
        "status": "missing_from_workspace",
        "searched_roots": ["eval/results", "../Developer"],
        "reason": "No raw or derived artifact directory was found; no numerical values were consolidated.",
    }
    write_json(output / "external-comparison-status.json", external_missing)
    generated.append(output / "external-comparison-status.json")

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
            reporting_audit_commit=None,
            provenance={
                "host": rq1_manifest["provenance"]["host"],
                "docker_version": rq1_manifest["provenance"]["docker_version"],
                "oci_index_reference": rq1_manifest["provenance"][
                    "oci_index_reference"
                ],
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
            missing_provenance=[
                "Reporting/audit commit is not recorded in the RQ1 audit artifact."
            ],
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
            provenance={"environment": rq3_manifest["environment"]},
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
            reporting_audit_commit=None,
            provenance={
                "environment": rq4_manifest["environment"],
                "browser": rq4_manifest["rq4"]["browser"],
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
            missing_provenance=[
                "The generated RQ4 audit artifact does not record its own reporting/audit commit."
            ],
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
            execution_harness_commit=None,
            reporting_audit_commit=None,
            provenance=msagl_manifest["provenance"],
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
                "Execution and reporting harness commits are not recorded in the retained MSAGLJS manifest/audit.",
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
            status="authoritative_evidence_unavailable",
            run_id="thesis-final-fullmst-combined-v020-004",
            raw=None,
            derived=None,
            product_commit=None,
            execution_harness_commit=None,
            reporting_audit_commit=None,
            provenance={},
            dataset=None,
            layout=None,
            repetitions=None,
            counts=None,
            retry_policy=None,
            audit_result=None,
            report_congruent=None,
            primary_metrics=["first_meaningful_visual"],
            secondary_metrics=[],
            interpretation_constraints=[
                "Do not generate cross-system numeric claims until retained raw/derived evidence is supplied."
            ],
            missing_provenance=[
                "No external-comparison raw or derived artifact directory was found in the available workspace."
            ],
            predecessors=[],
            artifacts=[],
            root=root,
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
    args = parser.parse_args()
    root = repository_root()
    output = args.output_dir or root / "eval/results/derived/consolidated-final-v020"
    for path in build(root, output.resolve()):
        print(path)


if __name__ == "__main__":
    main()
