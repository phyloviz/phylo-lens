"""Read immutable campaign observations and derive paired timing summaries.

No benchmark runs or raw-file writes. Usage:
  python3 scripts/audit_external_comparison_details.py --thesis-root ~/Developer/Thesis
"""

import argparse
import csv
import hashlib
import json
from pathlib import Path
from statistics import median


def load(path):
    return json.loads(path.read_text())


def percentile(values, fraction):
    ordered = sorted(values)
    position = (len(ordered) - 1) * fraction
    lower = int(position)
    upper = min(lower + 1, len(ordered) - 1)
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--thesis-root", type=Path, required=True)
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).resolve().parents[1]
        / "eval/results/derived/external-comparison-audit-20261002",
    )
    args = parser.parse_args()
    repo = Path(__file__).resolve().parents[1]
    external = (
        args.thesis_root
        / "results/raw/final/final-external-fullmst-phylolens-0.2.0/thesis-final-fullmst-phylolens-v020-004"
    )
    rq1 = (
        repo
        / "eval/results/raw/rq1-final-fullmst-v022/thesis-final-rq1-fullmst-v022-002/observations.jsonl"
    )
    msagl = (
        repo
        / "eval/results/raw/rq5-msagljs-fullmst-v001/thesis-msagljs-fullmst-v001-001/observations.jsonl"
    )
    sources = [rq1, msagl] + sorted((external / "observations").glob("*.json"))
    hashes = {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in sources}
    external_rows = []
    for p in sorted((external / "observations").glob("*.json")):
        x = load(p)
        if x["phase"] != "measured" or x["dataset_id"] != "salmonella-fullmst-200000":
            continue
        assert x["status"] == "success"
        t = x["diagnostic_metrics"]["final_diagnostics"]["latest"]
        total = (t["t_visual"] - t["t0"]) / 1000
        prepare = (t["t_preparation_ready"] - t["t0"]) / 1000
        after = (t["t_visual"] - t["t_preparation_ready"]) / 1000
        assert abs(total - prepare - after) < 1e-8
        assert abs(total * 1000 - x["time_to_first_visual_output_ms"]) < 1e-5
        external_rows.append(
            dict(
                observation_id=p.stem,
                total_s=total,
                preparation_s=prepare,
                post_ready_s=after,
            )
        )
    assert len(external_rows) == 3
    rq1_rows = [json.loads(line) for line in rq1.read_text().splitlines()]
    rq1_rows = [
        x
        for x in rq1_rows
        if x["phase"] == "measured" and x["requested_nodes"] == 200000
    ]
    assert len(rq1_rows) == 5 and all(x["status"] == "success" for x in rq1_rows)
    rq1_times = [x["timing"]["preparation_wall_ms"] / 1000 for x in rq1_rows]
    assert {x["input_sha256"] for x in rq1_rows} == {
        "eb3dbb2c66597cb311bc65fc5871d696753f92a90e6f275d29273b17e2b54e4d"
    }
    rows = [json.loads(line) for line in msagl.read_text().splitlines()]
    derived = []
    for x in rows:
        if x["warmup"]:
            continue
        n = x.get("native") or {}
        successful = x["state"] == "success"
        d = dict(
            observation_id=x["observation_id"],
            node_count=x["node_count"],
            state=x["state"],
            included_in_timing_summary=successful,
        )
        for phase in ("total", "parse", "geometry", "layout", "tiling", "other"):
            d[phase + "_s"] = n[phase + "_ms"] / 1000 if successful else None
        d["processing_excluding_input_construction_s"] = (
            d["total_s"] - d["parse_s"] if successful else None
        )
        if successful:
            assert d["processing_excluding_input_construction_s"] >= 0
            assert (
                abs(
                    d["total_s"]
                    - sum(
                        d[k + "_s"]
                        for k in ("parse", "geometry", "layout", "tiling", "other")
                    )
                )
                < 0.0001
            )
        derived.append(d)
    summaries = []
    for count in sorted({d["node_count"] for d in derived}):
        cell = [d for d in derived if d["node_count"] == count]
        good = [d for d in cell if d["included_in_timing_summary"]]
        assert len(cell) == 5
        summary = dict(
            node_count=count,
            measured_count=len(cell),
            success_count=len(good),
            states=[d["state"] for d in cell],
        )
        for key in (
            "total_s",
            "parse_s",
            "geometry_s",
            "layout_s",
            "tiling_s",
            "processing_excluding_input_construction_s",
        ):
            summary["median_" + key] = median(d[key] for d in good) if good else None
            summary["p25_" + key] = (
                percentile([d[key] for d in good], 0.25) if good else None
            )
            summary["p75_" + key] = (
                percentile([d[key] for d in good], 0.75) if good else None
            )
        summaries.append(summary)
    args.output.mkdir(parents=True, exist_ok=True)
    with (args.output / "msagl-paired-observations.csv").open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(derived[0]))
        writer.writeheader()
        writer.writerows(derived)
    result = dict(
        provenance=hashes,
        boundaries=dict(
            msagl_total="adapted edge-list in browser to TileMap ready; excludes Newick conversion, file I/O, transfer and visual rendering",
            msagl_processing="per observation total_ms - parse_ms; excludes edge-list decoding AND native graph construction",
            phylolens="public view.load through first validated visual frame",
        ),
        phylolens_200k=dict(
            external_observations=external_rows,
            rq1_preparation_s=rq1_times,
            external_median_s=median(d["total_s"] for d in external_rows),
            rq1_median_s=median(rq1_times),
            median_difference_s=median(d["total_s"] for d in external_rows)
            - median(rq1_times),
            causal_attribution="unresolved: external product v0.2.0 versus RQ1 v0.2.2; historical preparation phase CPU/wall breakdown absent",
        ),
        msagl_summaries=summaries,
    )
    (args.output / "summary.json").write_text(json.dumps(result, indent=2) + "\n")
    assert hashes == {
        str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in sources
    }, "raw input changed"
    print(
        json.dumps(dict(phylolens=result["phylolens_200k"], msagl=summaries), indent=2)
    )


if __name__ == "__main__":
    main()
