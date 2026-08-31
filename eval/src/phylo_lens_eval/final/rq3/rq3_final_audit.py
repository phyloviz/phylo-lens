"""Raw-only audit and deterministic derived artifacts for final RQ3."""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
from types import SimpleNamespace
from pathlib import Path
from typing import Any

from ...core.common import validate_rq3_final_observation
from .rq3_final import (
    EXPERIMENT_ID,
    FINAL_RUN_ID_PATTERN,
    PRODUCT_RELEASE_COMMIT,
    PRODUCT_RELEASE_VERSION,
    _expected_quotient,
    load_config,
    sha256,
    summarize_cases,
)


def main() -> None:
    parser = argparse.ArgumentParser(description="Audit or report final RQ3 evidence.")
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("audit", "generate"):
        command = commands.add_parser(name)
        command.add_argument("--run-dir", type=Path, required=True)
        if name == "generate":
            command.add_argument("--output-dir", type=Path, required=True)
            command.add_argument("--reporting-audit-commit", required=True)
        command.add_argument("--allow-development", action="store_true")
    args = parser.parse_args()
    audit = audit_run(args.run_dir, require_final=not args.allow_development)
    if args.command == "audit":
        print(json.dumps(audit, indent=2, sort_keys=True))
        return
    if not audit["pass"]:
        raise SystemExit(
            "Final RQ3 audit failed; derived artifacts were not generated."
        )
    generate(args.run_dir, args.output_dir, args.reporting_audit_commit, audit)
    print(args.output_dir)


def audit_run(run_dir: Path, *, require_final: bool = True) -> dict[str, Any]:
    errors: list[str] = []
    manifest = _read_json(run_dir / "manifest.json", errors)
    config = _read_json(run_dir / "resolved-config.json", errors)
    source = _read_json(run_dir / "source.json", errors)
    layout = _read_json(run_dir / "layout.json", errors)
    cases = _read_jsonl(run_dir / "observations.jsonl", errors)
    raw_summary = _read_json(run_dir / "summary.json", errors)
    if not all((manifest, config, source, layout)):
        return _result(errors, run_dir, cases)
    try:
        expected_config = load_config()
        if config != expected_config:
            errors.append(
                "Resolved RQ3 configuration differs from frozen configuration."
            )
    except ValueError as error:
        errors.append(str(error))
    _audit_manifest(
        manifest, source, layout, cases, errors, require_final=require_final
    )
    _audit_retained_master(run_dir, source, layout, expected_config, errors)
    seen_levels: set[int] = set()
    for case in cases:
        _audit_case(case, source, layout, seen_levels, errors)
    if seen_levels != {0, 1, 2}:
        errors.append(
            "Terminal RQ3 cases are not exactly persisted levels 0, 1, and 2."
        )
    if raw_summary != summarize_cases(cases):
        errors.append("Raw summary is not congruent with terminal observations.")
    return _result(errors, run_dir, cases)


def _audit_retained_master(
    run_dir: Path,
    source_record: dict[str, Any],
    layout: dict[str, Any],
    config: dict[str, Any],
    errors: list[str],
) -> None:
    """Recompute retained bytes and semantic rows; never trust raw metadata alone."""
    from ...core.common import checksum_sha256
    from .rq3_final import inspect_layout

    database = run_dir / "prepared-layout" / "prepared_layout.sqlite3"
    if not database.is_file():
        errors.append("Retained sealed SQLite master is missing.")
        return
    current_sha = checksum_sha256(database)
    if current_sha != layout.get("database_sha256"):
        errors.append("Retained SQLite physical SHA256 differs from sealed metadata.")
    if database.stat().st_mode & 0o222:
        errors.append("Retained SQLite master remains write-capable.")
    for suffix in ("-wal", "-shm"):
        sidecar = database.with_name(database.name + suffix)
        if sidecar.exists() and sidecar.stat().st_size:
            errors.append(f"Retained SQLite master has non-empty {suffix} sidecar.")
    try:
        source = {
            "dataset": SimpleNamespace(
                dataset_id=source_record.get("dataset_id", config["dataset"]["id"])
            ),
            "node_ids": tuple(source_record["node_ids"]),
            "edges": tuple(tuple(edge) for edge in source_record["edges"]),
        }
        current = inspect_layout(
            database,
            source,
            config,
            layout.get("prepared_layout_id", ""),
        )
    except Exception as error:
        errors.append(f"Cannot immutably inspect retained SQLite master: {error}")
        return
    if current.get("table_sha256") != layout.get("table_sha256"):
        errors.append(
            "Retained SQLite semantic table hashes differ from sealed metadata."
        )
    for key in ("levels", "bounds", "source_position_count", "source_graph_edge_count"):
        if current.get(key) != layout.get(key):
            errors.append(f"Retained SQLite {key} differs from sealed metadata.")


def _audit_manifest(
    manifest: dict[str, Any],
    source: dict[str, Any],
    layout: dict[str, Any],
    cases: list[dict[str, Any]],
    errors: list[str],
    *,
    require_final: bool = True,
) -> None:
    if manifest.get("state") != "completed":
        errors.append("Manifest state is not completed.")
    if require_final and not FINAL_RUN_ID_PATTERN.fullmatch(
        str(manifest.get("run_id", ""))
    ):
        errors.append("Final audit requires a thesis-final-rq3-v020-NNN run ID.")
    if manifest.get("experiment_id") != EXPERIMENT_ID:
        errors.append("Manifest experiment ID differs from final RQ3.")
    if (
        manifest.get("expected_terminal_cases") != 3
        or manifest.get("observed_terminal_cases") != 3
        or len(cases) != 3
    ):
        errors.append("Final RQ3 must retain exactly three terminal LoD cases.")
    if (
        manifest.get("policy", {}).get("retries") != 0
        or manifest.get("policy", {}).get("performance_metrics") is not False
    ):
        errors.append("Manifest protocol records retries or performance metrics.")
    if manifest.get("product") != {
        "version": PRODUCT_RELEASE_VERSION,
        "release_commit": PRODUCT_RELEASE_COMMIT,
        "source_diff_empty": True,
    }:
        errors.append("Frozen product provenance/source-isolation proof is absent.")
    if (
        source.get("canonical_sha256")
        != "d0911c01bf4e149fc229812243717f91ce50343435a28f4e6b174d2166e638e9"
    ):
        errors.append("Canonical source SHA256 differs from frozen RQ3 input.")
    if (
        len(source.get("node_ids", [])) != 13075
        or len(source.get("edges", [])) != 13074
    ):
        errors.append(
            "Canonical source does not retain exactly 13,075 nodes and 13,074 edges."
        )
    if source.get("node_ids_sha256") != sha256(
        source.get("node_ids", [])
    ) or source.get("edge_sha256") != sha256(source.get("edges", [])):
        errors.append(
            "Canonical source ID/edge hashes are not congruent with retained rows."
        )
    if (
        layout.get("source_position_count") != 13075
        or layout.get("source_graph_edge_count") != 13074
    ):
        errors.append("Persisted layout does not prove the complete source universe.")
    levels = layout.get("levels", [])
    if [item.get("lod_level") for item in levels] != [0, 1, 2] or len(levels) != 3:
        errors.append(
            "Persisted level metadata is not exactly the frozen three-level matrix."
        )


def _audit_case(
    case: dict[str, Any],
    source: dict[str, Any],
    layout: dict[str, Any],
    seen_levels: set[int],
    errors: list[str],
) -> None:
    try:
        validate_rq3_final_observation(case)
    except ValueError as error:
        errors.append(f"Observation schema validation failed: {error}")
        return
    level = case.get("level", {}).get("lod_level")
    if level in seen_levels:
        errors.append(f"Duplicate terminal LoD level: {level}.")
    if isinstance(level, int):
        seen_levels.add(level)
    if (
        case.get("status") != "success"
        or case.get("terminal_classification") != "PASS"
        or case.get("failure_kind") != "none"
    ):
        errors.append(f"LoD level {level} is not a successful fidelity observation.")
    if case.get("source", {}).get("canonical_sha256") != source.get("canonical_sha256"):
        errors.append(f"LoD level {level} source provenance differs from raw source.")
    if (
        case.get("layout", {}).get("prepared_layout_id")
        != layout.get("prepared_layout_id")
        or case.get("layout", {}).get("database_sha256")
        != layout.get("database_sha256")
        or case.get("layout", {}).get("table_sha256") != layout.get("table_sha256")
    ):
        errors.append(
            f"LoD level {level} does not reuse the one persisted prepared layout."
        )
    if case.get("bounds", {}).get("sha256") != layout.get("bounds", {}).get(
        "sha256"
    ) or not case.get("bounds", {}).get("all_source_positions_contained"):
        errors.append(f"LoD level {level} does not use the frozen full-world bound.")
    membership, positions = case.get("membership", {}), case.get("positions", {})
    quotient, full_detail = (
        case.get("quotient_connectivity", {}),
        case.get("full_detail", {}),
    )
    if (
        membership.get("expected_count") != 13075
        or membership.get("observed_count") != 13075
        or membership.get("expected_source_ids_sha256")
        != membership.get("observed_represented_ids_sha256")
    ):
        errors.append(
            f"LoD level {level} does not exactly represent the canonical source universe."
        )
    if (
        membership.get("expected_source_ids_sha256")
        != sha256(membership.get("expected_source_ids", []))
        or membership.get("observed_represented_ids_sha256")
        != sha256(membership.get("observed_represented_ids", []))
        or membership.get("explicit_ids_sha256")
        != sha256(membership.get("explicit_ids", []))
        or membership.get("aggregate_member_ids_sha256")
        != sha256(membership.get("aggregate_member_ids", []))
        or membership.get("cluster_memberships_sha256")
        != sha256(membership.get("cluster_memberships", {}))
    ):
        errors.append(
            f"LoD level {level} membership hashes are not congruent with retained rows."
        )
    if (
        not membership.get("member_count_checks_pass")
        or positions.get("mismatch_count") != 0
    ):
        errors.append(
            f"LoD level {level} fails member-count or representative-position validation."
        )
    if (
        full_detail.get("node_count") != 13075
        or full_detail.get("edge_count") != 13074
        or full_detail.get("source_edge_set_sha256") != source.get("edge_sha256")
    ):
        errors.append(
            f"LoD level {level} full-detail counterfactual differs from canonical source."
        )
    if full_detail.get("source_node_ids_sha256") != membership.get(
        "expected_source_ids_sha256"
    ) or full_detail.get("source_position_rows_sha256") != positions.get(
        "canonical_position_rows_sha256"
    ):
        errors.append(
            f"LoD level {level} full-detail position/node hashes are incongruent."
        )
    groups = quotient.get("source_to_visual_group", {})
    if len(groups) != 13075 or quotient.get("source_to_visual_group_sha256") != sha256(
        sorted(groups.items())
    ):
        errors.append(
            f"LoD level {level} source-to-visual-group mapping is incomplete or noncanonical."
        )
    if set(groups) != set(source.get("node_ids", [])):
        errors.append(
            f"LoD level {level} source-to-visual-group mapping differs from source IDs."
        )
    independent_edges, independent_support, unmapped = _expected_quotient(
        source.get("edges", []), groups
    )
    observed_expected = {tuple(edge) for edge in quotient.get("expected_edge_set", [])}
    if unmapped or observed_expected != independent_edges:
        errors.append(
            f"LoD level {level} retained expected quotient is not source-derived."
        )
    if quotient.get("expected_edge_set_sha256") != quotient.get(
        "observed_edge_set_sha256"
    ) or quotient.get("expected_edge_count") != quotient.get("observed_edge_count"):
        errors.append(
            f"LoD level {level} quotient connectivity differs from source quotient semantics."
        )
    if quotient.get("expected_edge_set_sha256") != sha256(
        quotient.get("expected_edge_set", [])
    ) or quotient.get("observed_edge_set_sha256") != sha256(
        quotient.get("observed_edge_set", [])
    ):
        errors.append(
            f"LoD level {level} quotient edge hashes are not congruent with retained rows."
        )
    support = quotient.get("support", {})
    for edge, rows in independent_support.items():
        expected = {
            "source_edge_count": len(rows),
            "source_edge_ids_sha256": sha256(sorted(row[0] for row in rows)),
        }
        if support.get("%s|%s" % edge) != expected:
            errors.append(f"LoD level {level} quotient support differs for {edge}.")
            break
    if any(case.get("mismatches", {}).values()):
        errors.append(f"LoD level {level} retains semantic mismatch records.")


def generate(
    run_dir: Path,
    output_dir: Path,
    reporting_audit_commit: str,
    audit: dict[str, Any] | None = None,
) -> None:
    audit = audit or audit_run(run_dir)
    if not audit["pass"]:
        raise ValueError(
            "Cannot generate reports from audit-failing final RQ3 raw evidence."
        )
    if output_dir.exists():
        raise ValueError(f"Derived output directory already exists: {output_dir}")
    reports = build_reports(run_dir, reporting_audit_commit, audit)
    if reports != build_reports(run_dir, reporting_audit_commit, audit):
        raise ValueError("RQ3 derived reports are not deterministic in-memory.")
    output_dir.mkdir(parents=True)
    for name, contents in reports.items():
        (output_dir / name).write_bytes(contents)
    final = {
        **audit,
        "report_congruent": True,
        "reporting_audit_commit": reporting_audit_commit,
        "derived_sha256": {
            name: hashlib.sha256(contents).hexdigest()
            for name, contents in reports.items()
        },
    }
    (output_dir / "rq3-final-audit.json").write_bytes(_json_bytes(final))


def build_reports(
    run_dir: Path, reporting_audit_commit: str, audit: dict[str, Any]
) -> dict[str, bytes]:
    manifest = json.loads((run_dir / "manifest.json").read_text())
    cases = _read_jsonl(run_dir / "observations.jsonl", [])
    ordered = sorted(cases, key=lambda case: case["level"]["lod_level"])
    reduction_rows = [
        {
            "lod_level": case["level"]["lod_level"],
            "threshold": case["level"]["threshold"],
            **case["reduction"],
        }
        for case in ordered
    ]
    return {
        "rq3-summary.json": _json_bytes(summarize_cases(ordered)),
        "rq3-lod-reduction.csv": _csv_bytes(reduction_rows),
        "rq3-membership-validation.json": _json_bytes(
            [
                {
                    "case_id": case["case_id"],
                    "membership": case["membership"],
                    "mismatches": case["mismatches"],
                }
                for case in ordered
            ]
        ),
        "rq3-position-validation.json": _json_bytes(
            [
                {"case_id": case["case_id"], "positions": case["positions"]}
                for case in ordered
            ]
        ),
        "rq3-quotient-connectivity.json": _json_bytes(
            [
                {
                    "case_id": case["case_id"],
                    "quotient_connectivity": case["quotient_connectivity"],
                }
                for case in ordered
            ]
        ),
        "rq3-provenance.json": _json_bytes(
            {
                "run_id": manifest["run_id"],
                "scientific_question": manifest["scientific_question"],
                "product": manifest["product"],
                "source": manifest["source"],
                "layout": manifest["layout"],
                "policy": manifest["policy"],
                "reporting_audit_commit": reporting_audit_commit,
            }
        ),
        "rq3-lod-reduction.svg": _figure_svg(reduction_rows),
    }


def _result(
    errors: list[str], run_dir: Path, cases: list[dict[str, Any]]
) -> dict[str, Any]:
    return {
        "pass": not errors,
        "errors": errors,
        "run_dir": str(run_dir),
        "case_count": len(cases),
    }


def _read_json(path: Path, errors: list[str]) -> dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        errors.append(f"Cannot read {path.name}: {error}")
        return {}


def _read_jsonl(path: Path, errors: list[str]) -> list[dict[str, Any]]:
    try:
        return [
            json.loads(line)
            for line in path.read_text(encoding="utf-8").splitlines()
            if line
        ]
    except (OSError, json.JSONDecodeError) as error:
        errors.append(f"Cannot read {path.name}: {error}")
        return []


def _json_bytes(value: Any) -> bytes:
    return (json.dumps(value, indent=2, sort_keys=True) + "\n").encode()


def _csv_bytes(rows: list[dict[str, Any]]) -> bytes:
    stream = io.StringIO(newline="")
    fields = sorted({key for row in rows for key in row})
    writer = csv.DictWriter(stream, fieldnames=fields, lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    return stream.getvalue().encode()


def _figure_svg(rows: list[dict[str, Any]]) -> bytes:
    maximum = max(row["represented_source_nodes"] for row in rows)
    labels = [
        ("represented source nodes", "represented_source_nodes", "#1f4e79"),
        ("materialized visual nodes", "materialized_visual_nodes", "#d95f02"),
        ("visual primitives", "visual_primitives", "#7570b3"),
    ]
    bars: list[str] = []
    for index, row in enumerate(rows):
        base = 90 + index * 220
        for offset, (_, key, color) in enumerate(labels):
            height = round(250 * row[key] / maximum, 3)
            bars.append(
                f'<rect x="{base + offset * 42}" y="{310 - height}" width="32" height="{height}" fill="{color}"/><text x="{base + offset * 42}" y="330" font-size="11">{row["lod_level"]}</text>'
            )
    legend = "".join(
        f'<text x="{90 + index * 210}" y="30" font-size="13" fill="{color}">{label}</text>'
        for index, (label, _, color) in enumerate(labels)
    )
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="800" height="360" viewBox="0 0 800 360"><title>RQ3 persisted LoD representation reduction</title><line x1="60" y1="310" x2="760" y2="310" stroke="black"/>{legend}{"".join(bars)}<text x="60" y="350" font-size="12">Each group is one persisted LoD level, not a statistical replicate.</text></svg>\n'.encode()


if __name__ == "__main__":
    main()
