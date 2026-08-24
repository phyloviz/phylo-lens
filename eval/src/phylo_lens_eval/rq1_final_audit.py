"""Raw and derived audit for the closed OCI-backed final RQ1 campaign."""

from __future__ import annotations

import argparse
import csv
import json
import tempfile
from pathlib import Path
from typing import Any

from .rq1_final import (
    EXPECTED_RUN_ID,
    FinalRQ1Error,
    load_config,
    raw_summary,
    repository_root,
    verified_conditions,
)


def _rows(run_dir: Path) -> list[dict[str, Any]]:
    path = run_dir / "observations.jsonl"
    if not path.is_file():
        raise FinalRQ1Error(f"Missing final raw observations: {path}")
    return [
        json.loads(line)
        for line in path.read_text(encoding="utf-8").splitlines()
        if line
    ]


def audit(run_dir: Path, *, derived_dir: Path | None = None) -> dict[str, Any]:
    root, config = repository_root(), load_config()
    manifest = json.loads((run_dir / "manifest.json").read_text(encoding="utf-8"))
    if (
        manifest.get("run_id") != EXPECTED_RUN_ID
        or manifest.get("state") != "completed"
    ):
        raise FinalRQ1Error(
            "Selected directory is not the completed approved final RQ1 run."
        )
    provenance = manifest.get("provenance", {})
    product = config["product"]
    required = {
        "product_release_commit",
        "product_release_tag",
        "oci_index_reference",
        "npm_companion_version",
        "evaluation_harness_commit",
        "thesis_repository_commit",
        "product_source_diff_empty",
        "evaluation_harness_dirty",
        "thesis_repository_dirty",
        "verified_conditions",
    }
    if not required <= set(provenance):
        raise FinalRQ1Error(
            "Final RQ1 manifest lacks required product/harness provenance."
        )
    if (
        provenance["product_release_commit"] != product["release_commit"]
        or provenance["product_release_tag"] != product["release_tag"]
        or provenance["oci_index_reference"] != product["oci_index_reference"]
        or provenance["npm_companion_version"] != product["npm_companion_version"]
    ):
        raise FinalRQ1Error(
            "Final RQ1 product release provenance differs from the frozen OCI release."
        )
    if (
        provenance["evaluation_harness_dirty"]
        or provenance["thesis_repository_dirty"]
        or not provenance["product_source_diff_empty"]
    ):
        raise FinalRQ1Error(
            "Final RQ1 run was not launched from clean, product-preserving worktrees."
        )
    expected_conditions = {
        item["id"]: item for item in verified_conditions(root, config)
    }
    if {item["id"] for item in provenance["verified_conditions"]} != set(
        expected_conditions
    ):
        raise FinalRQ1Error(
            "Manifest input provenance does not cover the exact 15 approved conditions."
        )
    if any(
        item["sha256"] != expected_conditions[item["id"]]["sha256"]
        for item in provenance["verified_conditions"]
    ):
        raise FinalRQ1Error(
            "Manifest input checksum differs from the retained approved input."
        )
    rows = _rows(run_dir)
    expected = {
        (condition, phase, index)
        for condition in expected_conditions
        for phase, count in (("warmup", 1), ("measured", 5))
        for index in range(count)
    }
    seen = {
        (row.get("condition_id"), row.get("phase"), row.get("repetition_index"))
        for row in rows
    }
    if len(rows) != 90 or seen != expected or len(seen) != len(rows):
        raise FinalRQ1Error(
            "Final RQ1 must retain exactly 90 unique raw observations (1 warm-up + 5 measured for every condition)."
        )
    for row in rows:
        condition = expected_conditions[row["condition_id"]]
        if (
            row.get("input_sha256") != condition["sha256"]
            or row.get("requested_leaves") != condition["requested_leaves"]
            or row.get("parsed_nodes") != condition["parsed_nodes"]
            or row.get("parsed_edges") != condition["parsed_edges"]
            or row.get("topology") != condition["topology"]
            or row.get("seed") != condition["seed"]
        ):
            raise FinalRQ1Error(
                "Raw observation condition or checksum differs from the frozen matrix."
            )
        observation_dir = (
            run_dir / "conditions" / row["condition_id"] / row["observation_id"]
        )
        required_artifacts = (
            "observation.json",
            "request.json",
            "status-polls.json",
            "persistence",
        )
        if not all(
            (observation_dir / artifact).exists() for artifact in required_artifacts
        ):
            raise FinalRQ1Error(
                "Raw observation lacks required retained request, status, or persistence evidence."
            )
        if (
            json.loads(
                (observation_dir / "observation.json").read_text(encoding="utf-8")
            )
            != row
        ):
            raise FinalRQ1Error(
                "Per-observation raw record is not congruent with the run observation stream."
            )
        if (
            row.get("health") is not None
            and not (observation_dir / "service.log").is_file()
        ):
            raise FinalRQ1Error(
                "Started service observation lacks retained service log evidence."
            )
        if row.get("status") not in {"success", "failure", "timeout", "invalid"}:
            raise FinalRQ1Error("Raw observation has an unsupported terminal status.")
        if row.get("status") == "success":
            if row.get("layout_status") != "ready" or not row.get("memory", {}).get(
                "sfdp_observed"
            ):
                raise FinalRQ1Error(
                    "A successful non-trivial final observation lacks verified ready sfdp evidence."
                )
            if row.get("memory", {}).get("scope") != "process_tree":
                raise FinalRQ1Error(
                    "Root-only or unavailable memory cannot qualify as final RQ1 memory evidence."
                )
            if not row.get("graphviz", {}).get("gts_capability_smoke"):
                raise FinalRQ1Error(
                    "Successful final observation lacks the required released-image Graphviz/GTS smoke."
                )
            runtime = row.get("oci_runtime") or {}
            labels = (
                runtime.get("image_inspect", {}).get("Config", {}).get("Labels", {})
            )
            if (
                runtime.get("image_reference") != product["oci_index_reference"]
                or not runtime.get("runtime_platform")
                or not runtime.get("platform_manifest_digest")
                or labels.get("org.opencontainers.image.revision")
                != product["release_commit"]
                or labels.get("org.opencontainers.image.version")
                != product["release_tag"].lstrip("v")
            ):
                raise FinalRQ1Error(
                    "Successful final observation lacks resolved OCI platform-manifest provenance."
                )
            terminal_result = row.get("terminal", {}).get("result", {})
            if (
                terminal_result.get("node_count") != condition["parsed_nodes"]
                or terminal_result.get("edge_count") != condition["parsed_edges"]
            ):
                raise FinalRQ1Error(
                    "Successful final observation does not retain the expected parsed-node/edge identity."
                )
    expected_summary = raw_summary(rows)
    if (
        json.loads((run_dir / "summary.json").read_text(encoding="utf-8"))
        != expected_summary
    ):
        raise FinalRQ1Error(
            "Stored summary is not a raw-only deterministic projection."
        )
    report_ok = None
    if derived_dir is not None:
        with tempfile.TemporaryDirectory() as temporary:
            generated = write_report(run_dir, Path(temporary))
            report_ok = all(
                (derived_dir / path.name).is_file()
                and (derived_dir / path.name).read_bytes() == path.read_bytes()
                for path in generated.values()
            )
        if not report_ok:
            raise FinalRQ1Error(
                "Final RQ1 derived report is not congruent with raw observations."
            )
    return {
        "status": "passed",
        "run_id": manifest["run_id"],
        "expected_raw_observations": 90,
        "observed_raw_observations": len(rows),
        "warmups_retained": 1,
        "measured_repetitions": 5,
        "product_release_commit": product["release_commit"],
        "evaluation_harness_commit": provenance["evaluation_harness_commit"],
        "thesis_repository_commit": provenance["thesis_repository_commit"],
        "raw_only_summary": True,
        "report_congruent": report_ok,
    }


def _write_csv(path: Path, rows: list[dict[str, Any]]) -> None:
    fields = sorted({key for row in rows for key in row})
    with path.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.DictWriter(stream, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def write_report(run_dir: Path, output_dir: Path) -> dict[str, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    payload = {
        "run_id": json.loads((run_dir / "manifest.json").read_text(encoding="utf-8"))[
            "run_id"
        ],
        "summary": raw_summary(_rows(run_dir)),
    }
    summary_path = output_dir / "rq1-final-summary.json"
    summary_path.write_text(
        json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    rows = []
    for group in payload["summary"]["groups"]:
        timing = group["preparation_wall_ms"] or {}
        memory = group["process_tree_peak_rss_bytes"] or {}
        rows.append(
            {
                "condition_id": group["condition_id"],
                "requested_leaves": group["requested_leaves"],
                "parsed_nodes": group["parsed_nodes"],
                "parsed_edges": group["parsed_edges"],
                "topology": group["topology"],
                "seed": group["seed"],
                "warmup_count": group["warmup_count"],
                "measured_count": group["measured_count"],
                "success_count": group["success_count"],
                "failure_count": group["failure_count"],
                "timeout_count": group["timeout_count"],
                "invalid_count": group["invalid_count"],
                "preparation_median_ms": timing.get("median"),
                "preparation_p25_ms": timing.get("p25"),
                "preparation_p75_ms": timing.get("p75"),
                "preparation_iqr_ms": timing.get("iqr"),
                "preparation_min_ms": timing.get("minimum"),
                "preparation_max_ms": timing.get("maximum"),
                "process_tree_rss_median_bytes": memory.get("median"),
                "memory_unavailable_count": group["memory_unavailable_count"],
            }
        )
    table_path = output_dir / "rq1-final-timing-memory.csv"
    _write_csv(table_path, rows)
    return {"summary": summary_path, "timing_memory": table_path}


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Audit or derive the final OCI-backed RQ1 campaign."
    )
    parser.add_argument("action", choices=("audit", "report"))
    parser.add_argument("--run-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if args.action == "report":
        if args.output_dir is None:
            parser.error("report requires --output-dir")
        print(
            json.dumps(
                {
                    key: str(value)
                    for key, value in write_report(
                        args.run_dir, args.output_dir
                    ).items()
                },
                indent=2,
                sort_keys=True,
            )
        )
        return
    report = audit(args.run_dir, derived_dir=args.output_dir)
    if args.output is None:
        print(json.dumps(report, indent=2, sort_keys=True))
    else:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(
            json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8"
        )
        print(args.output)


if __name__ == "__main__":
    main()
