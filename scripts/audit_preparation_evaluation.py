"""Audit current-source preparation/visual observations without editing raw data."""

import argparse
import csv
import json
import shutil
import sqlite3
import subprocess
from collections import Counter
from importlib.metadata import version
from pathlib import Path
from statistics import median, quantiles

from run_local_rq34 import file_hash, write
from run_preparation_evaluation import summaries


def records(path):
    return [json.loads(line) for line in path.read_text().splitlines() if line]


def audit(directory, completed_cells_only=False):
    manifest = json.loads((directory / "manifest.json").read_text())
    assert manifest["state"] == "completed" or (
        completed_cells_only and manifest["state"] == "interrupted_infrastructure"
    )
    assert manifest["product_source_unchanged"]
    bundle = Path(manifest["product_root"]) / "code/client/dist/index.js"
    assert file_hash(bundle) == manifest["client_bundle_sha256"]
    shutil.copyfile(bundle, directory / "client-bundle.js")
    for rel, digest in manifest["product_source_sha256"].items():
        assert file_hash(directory / "product-source" / rel) == digest
    for rel, digest in manifest["harness_sha256"].items():
        assert file_hash(directory / "harness" / rel) == digest
    rows = records(directory / "observations.jsonl")
    counts = Counter((r["tool"], r["nodes"], r["warmup"]) for r in rows)
    details = []
    browsers = set()
    for (tool, nodes, warmup), count in counts.items():
        assert count == (1 if warmup else manifest["measured_repetitions"])
    for row in rows:
        observation = (
            directory
            / row["tool"]
            / str(row["nodes"])
            / ("warmup" if row["warmup"] else f"measured-{row['repetition']:03}")
        )
        assert json.loads((observation / "observation.json").read_text()) == row
        if row["status"] != "success":
            assert row.get("error"), f"Failure without evidence: {observation}"
            continue
        assert row["elapsed_ms"] > 0
        evidence = dict(row)
        if manifest["campaign"] == "external":
            control = json.loads((observation / "control.json").read_text())
            assert file_hash(Path(control["dataset"])) == row["source_sha256"]
            raw = json.loads((observation / "result.json").read_text())
            adapter = raw["adapter"]
            assert (
                raw["status"] == "success" and not raw["errors"] and not raw["blocked"]
            )
            assert raw["gpu"]["hardware_accelerated"]
            assert raw["browser"]["viewport"] == {"width": 1440, "height": 900}
            browsers.add(raw["browser"]["version"])
            assert abs(adapter["t_visual"] - adapter["t0"] - row["elapsed_ms"]) < 0.01
            assert (observation / "after.png").stat().st_size > 0
            evidence["representation"] = adapter.get("representation")
            if row["tool"] == "phylolens":
                assert (
                    adapter["t0"]
                    <= adapter["t_preparation_ready"]
                    <= adapter["t_visual"]
                )
                evidence["public_load_to_ready_ms"] = (
                    adapter["t_preparation_ready"] - adapter["t0"]
                )
                evidence["ready_to_visual_ms"] = (
                    adapter["t_visual"] - adapter["t_preparation_ready"]
                )
                ready = [
                    r
                    for r in raw["requests"]
                    if "/prepare/" in r["url"] and r.get("node_count")
                ]
                assert ready and ready[-1]["node_count"] == row["nodes"]
                assert ready[-1]["edge_count"] == row["nodes"] - 1
                evidence["count_fidelity"] = (
                    "verified preparation counts; not full edge/identity equivalence"
                )
                viewport = [
                    r
                    for r in raw["requests"]
                    if "/viewport" in r["url"] and r.get("node_count") is not None
                ]
                assert viewport and all(not r.get("truncated") for r in viewport)
                evidence["initial_viewport_reply"] = viewport[0]
                assert any(
                    layer["pixels"]["valid"]
                    for layer in adapter["visual"]["canvas_evidence"]
                )
            elif row["tool"] == "phylotree":
                assert adapter["observed_counts"]["nodes"] == row["nodes"]
        else:
            assert row["prepared"]["node_count"] == row["nodes"]
            assert row["prepared"]["edge_count"] == row["nodes"] - 1
            polls = json.loads((observation / "polls.json").read_text())
            assert polls[-1]["body"]["status"] == "ready"
        if row["tool"] == "phylolens":
            profile = records(observation / "preparation-profile.jsonl")
            assert profile and all(p["wall_s"] > 0 for p in profile)
            phases = {p["phase"]: p for p in profile}
            assert "graphviz_process_only" in phases
            evidence["phases"] = phases
            sample = records(observation / "resources.jsonl")
            evidence["peak_process_tree_rss_bytes"] = max(
                s["rss_bytes"] for s in sample
            )
            assert (observation / "persistence-inventory.json").exists()
        details.append(evidence)
    assert len(browsers) <= 1
    summary = summaries(rows)
    assert summary == json.loads((directory / "summary.json").read_text())
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
        key: manifest[key]
        for key in (
            "protocol",
            "product_commit",
            "product_fingerprint",
            "package_version",
            "published_release",
        )
    }
    write(
        directory / "summary-with-provenance.json",
        {"provenance": provenance, "cells": summary},
    )
    write(directory / "audited-observations.json", details)
    shutil.copyfile(Path(__file__), directory / "audit-source.py")
    executable = Path(shutil.which("sfdp")).resolve()
    receipt = executable.parent.parent / "INSTALL_RECEIPT.json"
    graphviz_build = {
        "executable_at_audit": str(executable),
        "sha256_at_audit": file_hash(executable),
    }
    if receipt.exists():
        graphviz_build["homebrew_receipt"] = json.loads(receipt.read_text())
        shutil.copyfile(receipt, directory / "graphviz-install-receipt.json")
    write(
        directory / "environment-audit.json",
        {
            "node_version_at_audit": subprocess.check_output(
                ["rtk", "proxy", "node", "--version"], text=True
            ).strip(),
            "sqlite_version": sqlite3.sqlite_version,
            "server_packages": {
                name: version(name)
                for name in ("fastapi", "starlette", "pydantic", "uvicorn")
            },
            "display_metadata_at_campaign_start": manifest["display_metadata"],
            "browser_runtime_versions_from_observations": sorted(browsers),
            "audit_script_sha256": file_hash(Path(__file__)),
            "graphviz_build_at_audit": graphviz_build,
            "quantile_method": "statistics.quantiles inclusive; linear sample quantiles; warm-ups and failures excluded",
        },
    )
    write(
        directory / "audit.json",
        {
            "passed": True,
            "observations": len(rows),
            "successes": len(details),
            "measured": sum(not r["warmup"] for r in rows),
            "browser_versions": sorted(browsers),
            "product_fingerprint": manifest["product_fingerprint"],
            "raw_unchanged": True,
            "completed_cells_only": completed_cells_only,
            "nodes_audited": sorted({r["nodes"] for r in rows}),
            "limits": "Success is visual/ready evidence, not full phylogenetic fidelity; failures remain failures; nested CPU spans overlap.",
        },
    )
    with (directory / "summary.csv").open("w") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(provenance) + list(summary[0]))
        writer.writeheader()
        writer.writerows(provenance | row for row in summary)
    lines = [
        "# Current-source preparation / external evidence",
        "",
        f"Protocol `{manifest['protocol']}`; source fingerprint `{manifest['product_fingerprint']}`; base commit `{manifest['product_commit']}`. Package version is metadata, not a released artifact.",
        "",
        f"Graphviz: {manifest['graphviz']}. One excluded warm-up and {manifest['measured_repetitions']} fresh observations per cell. Browser versions: {', '.join(sorted(browsers)) or 'not applicable'}.",
        "",
        "| Tool | Nodes | Success / measured | Median total s | Load→ready s | Ready→visual s | SFDP wall s | SFDP mean CPU equivalents |",
        "|---|---:|---:|---:|---:|---:|---:|---:|",
    ]
    for group in summary:
        good = [
            r
            for r in details
            if not r["warmup"]
            and (r["tool"], r["nodes"]) == (group["tool"], group["nodes"])
        ]

        def med(key, observations=good):
            values = [r[key] for r in observations if key in r]
            return f"{median(values) / 1000:.3f}" if values else "—"

        sfdp = [r["phases"]["graphviz_process_only"] for r in good if "phases" in r]
        wall = f"{median(p['wall_s'] for p in sfdp):.3f}" if sfdp else "—"
        cpu = f"{median(p['mean_core_equivalents'] for p in sfdp):.2f}" if sfdp else "—"
        total = (
            f"{group['median_ms'] / 1000:.3f}"
            if group["median_ms"] is not None
            else "—"
        )
        lines.append(
            f"| {group['tool']} | {group['nodes']} | {group['success']}/{group['measured']} | {total} | {med('public_load_to_ready_ms')} | {med('ready_to_visual_ms')} | {wall} | {cpu} |"
        )
    lines += [
        "",
        "CPU equivalents = process and reaped child CPU seconds / wall seconds, not physical cores. Graphviz process-only includes parent wait overhead. Nested phases must not be summed. Physical display refresh was not controlled.",
        "",
        "Input file reading and transfer to the page, service/browser startup and post-boundary screenshots are excluded. Inputs are retained Full-MST Newick, counted as canonical nodes, not leaves. Browser filesystem caches are not asserted cold.",
        "",
        "The PhyloLens canvas predicate is explicitly protocol v2; Phylotree SVG and Taxonium loading-overlay/same-frame bitmap predicates retain their source wrappers. Inspect each adapter's representation fidelity status; a visual success does not imply preserved labels or all edges.",
        "",
        "PhyloLens displays an aggregated initial viewport, Phylotree produces its native SVG tree, and Taxonium displays its native initial tiles. These are first-output boundaries, not equal numbers of rendered canonical nodes. The first viewport reply's counts are retained in audited-observations.json; they are payload counts, not an audited count of on-screen marks at the timestamp.",
    ]
    (directory / "REPORT.md").write_text("\n".join(lines) + "\n")
    print(
        json.dumps(
            {"passed": True, "directory": str(directory), "observations": len(rows)}
        )
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("--completed-cells-only", action="store_true")
    args = parser.parse_args()
    audit(args.directory.resolve(), args.completed_cells_only)
