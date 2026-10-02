"""Combine independently audited, disjoint completed cells after an infrastructure interruption."""

import argparse
import csv
import json
from collections import Counter
from pathlib import Path
from statistics import quantiles

from audit_preparation_evaluation import records
from run_local_rq34 import file_hash, write
from run_preparation_evaluation import COUNTS, summaries


def combine(sources, output):
    output.mkdir(parents=True, exist_ok=False)
    manifests, rows, details = [], [], []
    source_evidence = []
    for directory in sources:
        manifest = json.loads((directory / "manifest.json").read_text())
        audit = json.loads((directory / "audit.json").read_text())
        assert audit["passed"]
        manifests.append(manifest)
        for row in records(directory / "observations.jsonl"):
            row["raw_run"] = str(directory)
            rows.append(row)
        for row in json.loads((directory / "audited-observations.json").read_text()):
            row["raw_run"] = str(directory)
            details.append(row)
        source_evidence.append(
            {
                "directory": str(directory),
                "state": manifest["state"],
                "manifest_sha256": file_hash(directory / "manifest.json"),
                "audit_sha256": file_hash(directory / "audit.json"),
                "observations_sha256": file_hash(directory / "observations.jsonl"),
            }
        )
    baseline = manifests[0]
    for manifest in manifests:
        for key in (
            "protocol",
            "product_fingerprint",
            "client_bundle_sha256",
            "harness_sha256",
            "graphviz",
            "measured_repetitions",
            "tool_dependencies",
        ):
            assert manifest[key] == baseline[key], f"Protocol/provenance drift: {key}"
    counts = Counter((r["tool"], r["nodes"], r["warmup"]) for r in rows)
    assert set(counts) == {
        (tool, nodes, warmup)
        for tool in ("phylolens", "phylotree", "taxonium")
        for nodes in COUNTS
        for warmup in (True, False)
    }
    assert all(
        count == (1 if warmup else 3) for (_, _, warmup), count in counts.items()
    )
    assert len(rows) == 120 and sum(not r["warmup"] for r in rows) == 90
    browsers = {r["browser"]["version"] for r in rows if r["status"] == "success"}
    assert len(browsers) == 1
    summary = summaries(rows)
    for group in summary:
        values = [
            r["elapsed_ms"]
            for r in rows
            if not r["warmup"]
            and r["status"] == "success"
            and (r["tool"], r["nodes"]) == (group["tool"], group["nodes"])
        ]
        quartiles = (
            quantiles(values, n=4, method="inclusive")
            if len(values) > 1
            else [values[0] if values else None] * 3
        )
        group.update(p25_ms=quartiles[0], p75_ms=quartiles[2])
    provenance = {
        key: baseline[key]
        for key in (
            "protocol",
            "product_commit",
            "product_fingerprint",
            "package_version",
            "published_release",
        )
    }
    write(output / "summary.json", {"provenance": provenance, "cells": summary})
    write(output / "observations.json", rows)
    write(output / "audited-observations.json", details)
    write(
        output / "audit.json",
        {
            "passed": True,
            "observations": 120,
            "warmups": 30,
            "measured": 90,
            "successes_measured": sum(
                not r["warmup"] and r["status"] == "success" for r in rows
            ),
            "sources": source_evidence,
            "same_measurement_source_hashes": True,
            "replacement": "Only 200k rerun after ENOSPC in its original warm-up; original diagnostics retained. No measured 200k observation was overwritten.",
        },
    )
    with (output / "summary.csv").open("w") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(provenance) + list(summary[0]))
        writer.writeheader()
        writer.writerows(provenance | row for row in summary)
    lines = [
        "# Final external comparison — current local source",
        "",
        f"Source fingerprint `{baseline['product_fingerprint']}`; base commit `{baseline['product_commit']}`. Independent audits passed: 90 measured observations and 30 excluded warm-ups. Source hashes, browser and Graphviz match across the two raw runs.",
        "",
        "The original 200k warm-up failed because the disk filled; only 200k was rerun. Results up to 150k were preserved. Raw diagnostics and the original interrupted manifest remain available. This infrastructure replacement is explicit, not a hidden measurement retry.",
        "",
        "| Tool | Canonical nodes | Success / measured | Median first output s | P25–P75 s |",
        "|---|---:|---:|---:|---:|",
    ]
    for group in summary:
        total = (
            f"{group['median_ms'] / 1000:.3f}"
            if group["median_ms"] is not None
            else "—"
        )
        spread = (
            f"{group['p25_ms'] / 1000:.3f}–{group['p75_ms'] / 1000:.3f}"
            if group["p25_ms"] is not None
            else "—"
        )
        lines.append(
            f"| {group['tool']} | {group['nodes']} | {group['success']}/{group['measured']} | {total} | {spread} |"
        )
    lines += [
        "",
        "These are native first-output boundaries, not equal full-tree rendering workloads. PhyloLens uses an aggregated initial viewport; Phylotree uses its SVG and Taxonium initial native tiles. Fidelity statuses, preparation CPU/wall spans and viewport payload counts remain in audited-observations.json and the source reports.",
        "",
        "The pinned historical MSAGL MDS baseline remains separate: tile-ready is not a first rendered frame. Its paired total and construction-excluded metrics are unchanged. Current RQ1 is ready for a separate user run with the same native service/Graphviz path.",
    ]
    (output / "REPORT.md").write_text("\n".join(lines) + "\n")
    print("COMBINED AUDIT PASS", output)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("sources", type=Path, nargs="+")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    combine([p.resolve() for p in args.sources], args.output.resolve())
