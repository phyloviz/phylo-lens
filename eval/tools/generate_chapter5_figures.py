#!/usr/bin/env python3
"""Render current audited Chapter 5 evidence, without embedded figure titles."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import os
import platform
from collections import defaultdict
from pathlib import Path
from statistics import median

ROOT = Path(__file__).resolve().parents[2]
PATHS = {
    "rq1": "eval/results/local/current-rq1-final-USER",
    "evidence": "eval/results/local/current-evidence-final-20261002",
    "rq3": "eval/results/local/current-prepared-100k-20261002",
    "external": "eval/results/derived/current-external-combined-20261002",
    "msagl": "eval/results/derived/external-comparison-audit-20261002",
}
COLORS = ["#1b6ca8", "#c45b21", "#3d7d4a", "#755292", "#555555"]
MARKERS = ["o", "s", "^", "D", "v"]


def read(path):
    return json.loads(path.read_text())


def sha256(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def quantile(values, fraction):
    values = sorted(values)
    if not values or not 0 <= fraction <= 1:
        raise ValueError("A quantile requires observations and a fraction in [0, 1].")
    rank = (len(values) - 1) * fraction
    lower = math.floor(rank)
    upper = math.ceil(rank)
    return values[lower] + (values[upper] - values[lower]) * (rank - lower)


def statistics(values):
    if not values or not all(math.isfinite(v) for v in values):
        raise ValueError("Cannot plot an empty or non-finite metric.")
    return dict(
        n=len(values),
        median=median(values),
        p25=quantile(values, 0.25),
        p75=quantile(values, 0.75),
        minimum=min(values),
        maximum=max(values),
    )


def measured(rows):
    return [
        r
        for r in rows
        if not r["warmup"]
        and r.get("status", "success") == "success"
        and r.get("valid", True)
    ]


def aggregate(rows, metric, x, series, condition=lambda r: r["condition"]):
    groups = defaultdict(list)
    for row in rows:
        value = metric(row)
        if value is not None:
            groups[(condition(row), x(row), series(row))].append(value)
    return [
        dict(condition=c, x=x_value, series=s, **statistics(values))
        for (c, x_value, s), values in sorted(
            groups.items(), key=lambda kv: (kv[0][2], kv[0][1], kv[0][0])
        )
    ]


def validate_sources(paths):
    rq1_audit = read(paths["rq1"] / "audit.json")
    rq1_manifest = read(paths["rq1"] / "manifest.json")
    assert rq1_manifest["state"] == "completed" and rq1_audit["passed"]
    assert read(paths["evidence"] / "audit.json")["valid"]
    assert read(paths["external"] / "audit.json")["passed"]
    external = read(paths["external"] / "summary.json")
    evidence = read(paths["evidence"] / "summary-with-provenance.json")
    fingerprints = {
        rq1_manifest["product_fingerprint"],
        external["provenance"]["product_fingerprint"],
        evidence["provenance"]["product_fingerprint"],
    }
    assert (
        len(fingerprints) == 1
    ), "Current campaigns have different product identities."
    rq3 = read(paths["rq3"] / "rq3.json")
    assert all(r["invariants"] == "PASS" for r in rq3)
    assert rq3[-1]["aggregates"] == 0
    return rq1_manifest["product_fingerprint"]


class Renderer:
    def __init__(self, output, sources, dpi):
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt

        self.plt, self.output, self.sources, self.dpi = plt, output, sources, dpi
        self.records = []
        output.mkdir(parents=True, exist_ok=True)
        plt.rcParams.update(
            {
                "font.family": "DejaVu Sans",
                "font.size": 10,
                "axes.labelsize": 10,
                "legend.fontsize": 9,
                "xtick.labelsize": 9,
                "ytick.labelsize": 9,
                "pdf.fonttype": 42,
                "ps.fonttype": 42,
                "axes.linewidth": 0.8,
                "lines.linewidth": 1.25,
            }
        )

    def axes(self, height=3.9):
        fig, ax = self.plt.subplots(figsize=(7.0, height), layout="constrained")
        ax.spines[["top", "right"]].set_visible(False)
        ax.tick_params(direction="out", length=3)
        ax.grid(axis="x" if height > 5 else "y", linewidth=0.45, alpha=0.35)
        ax.set_axisbelow(True)
        return fig, ax

    def save(self, fig, stem, rows, caption):
        # A guard prevents later changes from reintroducing titles.
        assert not fig._suptitle or not fig._suptitle.get_text()
        assert all(
            not ax.get_title()
            and not ax.get_title(loc="left")
            and not ax.get_title(loc="right")
            for ax in fig.axes
        )
        fig.canvas.draw()
        for suffix in ["pdf", "png"]:
            fig.savefig(self.output / f"{stem}.{suffix}", dpi=self.dpi)
        self.plt.close(fig)
        fields = list(dict.fromkeys(k for row in rows for k in row))
        with (self.output / f"{stem}.csv").open("w", newline="") as stream:
            writer = csv.DictWriter(stream, fieldnames=fields)
            writer.writeheader()
            writer.writerows(rows)
        files = {
            f"{stem}.{suffix}": sha256(self.output / f"{stem}.{suffix}")
            for suffix in ["pdf", "png", "csv"]
        }
        record = dict(
            stem=stem,
            caption=caption,
            files=files,
            source_sha256=self.sources,
            width_inches=7.0,
            height_inches=float(fig.get_size_inches()[1]),
            quantiles="linear inclusive; median and P25–P75; no confidence interval",
            internal_titles=False,
        )
        (self.output / f"{stem}.provenance.json").write_text(
            json.dumps(record, indent=2) + "\n"
        )
        self.records.append(record)

    def curves(
        self,
        stem,
        rows,
        xlabel,
        ylabel,
        caption,
        logx=False,
        logy=False,
        horizontal_labels=None,
        connect=True,
        size_ticks=False,
        censor=None,
    ):
        fig, ax = self.axes(5.8 if horizontal_labels else 3.9)
        for i, series in enumerate(dict.fromkeys(r["series"] for r in rows)):
            data = sorted(
                [r for r in rows if r["series"] == series], key=lambda r: r["x"]
            )
            xs = [r["x"] for r in data]
            ys = [r["median"] for r in data]
            error = [
                [r["median"] - r["p25"] for r in data],
                [r["p75"] - r["median"] for r in data],
            ]
            opts = dict(
                marker=MARKERS[i % 5],
                markersize=3.4,
                capsize=4,
                elinewidth=1.2,
                color=COLORS[i % 5],
                label=series,
                linestyle="-" if connect and not horizontal_labels else "none",
            )
            if horizontal_labels:
                ax.errorbar(ys, xs, xerr=error, **opts)
            else:
                ax.errorbar(xs, ys, yerr=error, **opts)
        if censor:
            ax.scatter(
                [censor["x"]],
                [censor["y"]],
                marker="^",
                facecolors="none",
                edgecolors=COLORS[1],
                label=censor["label"],
                zorder=4,
            )
        if logx:
            ax.set_xscale("log")
        if logy:
            ax.set_yscale("log")
        if horizontal_labels:
            ax.set_yticks(range(len(horizontal_labels)), horizontal_labels)
            ax.invert_yaxis()
        elif size_ticks:
            xs = sorted({r["x"] for r in rows})
            if censor:
                xs = sorted(set(xs + [censor["x"]]))
            ax.set_xticks(xs, [f"{x:g}" for x in xs], rotation=35, ha="right")
        ax.set_xlabel(xlabel)
        ax.set_ylabel(ylabel)
        ax.legend(frameon=False, loc="upper center", bbox_to_anchor=(0.5, 1.21), ncol=2)
        self.save(fig, stem, rows + ([dict(censor)] if censor else []), caption)


def generate(paths, output, dpi=220):
    fingerprint = validate_sources(paths)
    source_files = [
        paths["rq1"] / n
        for n in ["manifest.json", "audit.json", "audited-observations.json"]
    ]
    source_files += [
        paths["evidence"] / n
        for n in [
            "audit.json",
            "observations.json",
            "timing-dispersion.json",
            "summary-with-provenance.json",
        ]
    ]
    source_files += [
        paths["rq3"] / "rq3.json",
        paths["external"] / "summary.json",
        paths["external"] / "audit.json",
        paths["msagl"] / "msagl-paired-observations.csv",
        paths["msagl"] / "summary.json",
        Path(__file__).resolve(),
    ]
    sources = {str(p): sha256(p) for p in source_files}
    renderer = Renderer(output, sources, dpi)
    rq1 = measured(read(paths["rq1"] / "audited-observations.json"))
    observations = measured(read(paths["evidence"] / "observations.json"))
    replay = [r for r in observations if r["campaign"] == "rq2-replay"]
    integrated = [r for r in observations if r["campaign"] == "rq2-integrated"]
    actions = [r for r in observations if r["campaign"] == "rq4"]
    basic = "Points show medians and whiskers P25–P75 across five successful measured observations per size; one warm-up per size is excluded. Narrow intervals can be obscured by markers."
    rq1_time = aggregate(
        rq1,
        lambda r: r["elapsed_ms"] / 1000,
        lambda r: r["nodes"] / 1000,
        lambda r: "PhyloLens",
        lambda r: str(r["nodes"]),
    )
    renderer.curves(
        "F1-rq1-preparation-time",
        rq1_time,
        "Tree size (×10³ nodes)",
        "Preparation time (s)",
        "RQ1 server-side preparation, measured from the preparation request to the first observed ready state with 100 ms polling; service startup and input-file reading are excluded. "
        + basic,
        size_ticks=True,
    )
    rq1_rss = aggregate(
        rq1,
        lambda r: r["peak_process_tree_rss_bytes"] / 1024**3,
        lambda r: r["nodes"] / 1000,
        lambda r: "PhyloLens",
        lambda r: str(r["nodes"]),
    )
    renderer.curves(
        "F1b-rq1-peak-rss",
        rq1_rss,
        "Tree size (×10³ nodes)",
        "Peak memory usage (GiB)",
        "RQ1 peak resident-set size of the PhyloLens service process tree, sampled every 20 ms over the service lifecycle; this is distinct from browser memory. "
        + basic,
        size_ticks=True,
    )
    sfdp = aggregate(
        rq1,
        lambda r: r["phases"]["graphviz_process_only"]["wall_s"],
        lambda r: r["nodes"] / 1000,
        lambda r: "Graphviz sfdp",
        lambda r: str(r["nodes"]),
    )
    renderer.curves(
        "F1c-rq1-sfdp-wall",
        sfdp,
        "Tree size (×10³ nodes)",
        "sfdp layout time (s)",
        "Wall-clock time of the Graphviz sfdp layout subprocess. This phase is nested within preparation and is therefore not additive with the overall preparation time. "
        + basic,
        size_ticks=True,
    )
    for key, ylabel, stem in [
        (
            "client_first_visualization_ms",
            "Time to first visualization (ms)",
            "F2-rq2-client-visualization-scalability",
        ),
        ("heap_delta", "Change in JavaScript heap (MiB)", "F2b-rq2-client-heap"),
    ]:
        rows = aggregate(
            replay,
            lambda r: (
                r.get("heap_delta") / 1024**2
                if key == "heap_delta" and r.get("heap_delta") is not None
                else r["timing"].get(key)
            ),
            lambda r: r["response"]["expected_primitive_count"],
            lambda r: (
                "Explicit node-and-edge representation"
                if r["condition"].startswith("detail-")
                else "Collapsed-subtree representation"
            ),
        )
        # Triangle-control is categorical: don't connect its points as a scalability series.
        fig, ax = renderer.axes()
        for i, series in enumerate(dict.fromkeys(r["series"] for r in rows)):
            data = sorted(
                [r for r in rows if r["series"] == series], key=lambda r: r["x"]
            )
            ax.errorbar(
                [r["x"] for r in data],
                [r["median"] for r in data],
                yerr=[
                    [r["median"] - r["p25"] for r in data],
                    [r["p75"] - r["median"] for r in data],
                ],
                marker=MARKERS[i],
                markersize=3.4,
                capsize=4,
                elinewidth=1.2,
                color=COLORS[i],
                linestyle=(
                    "-" if series == "Explicit node-and-edge representation" else "none"
                ),
                label=series,
            )
        ax.set_xscale("log")
        ax.set_xlabel("Rendering workload (log scale)")
        ax.set_ylabel(ylabel)
        ax.legend(frameon=False, loc="upper center", bbox_to_anchor=(0.5, 1.2), ncol=2)
        for row in rows:
            original = next(r for r in replay if r["condition"] == row["condition"])[
                "response"
            ]
            row.update(
                node_count=original["node_count"],
                edge_count=original["edge_count"],
                triangle_count=original["triangle_count"],
                unique_graph_elements=original["node_count"] + original["edge_count"],
            )
        renderer.save(
            fig,
            stem,
            rows,
            "RQ2 isolated browser replay, with five measured runs and one excluded warm-up per condition; points show medians and P25–P75. The horizontal axis reports the visual-element count used by the retained fixtures. For collapsed-subtree conditions, triangular glyphs encode collapsed nodes and are therefore not additional biological entities. The horizontal axis is logarithmic. "
            + (
                "Time to first visualization uses the operational boundary defined in the evaluation protocol; it does not imply completion of all later animation. "
                if key != "heap_delta"
                else "Heap deltas report browser JavaScript heap usage and should not be interpreted as total browser memory. "
            )
            + "Intervals narrower than markers can be hidden.",
        )
    integrated_rows = aggregate(
        integrated,
        lambda r: r["timing"]["first_visualization_ms"],
        lambda r: r["response"]["node_count"] + r["response"]["edge_count"],
        lambda r: "PhyloLens",
    )
    for row in integrated_rows:
        original = next(r for r in integrated if r["condition"] == row["condition"])[
            "response"
        ]
        row.update(
            node_count=original["node_count"],
            edge_count=original["edge_count"],
            lod_level=original["lod_level"],
            payload_bytes=original["payload_bytes"],
        )
    renderer.curves(
        "F2c-rq2-integrated-viewport",
        integrated_rows,
        "Viewport representation size (nodes + edges)",
        "Time to first visualization (ms)",
        "RQ2 integrated viewport conditions on the prepared 100,000-node tree. Five measured runs and one excluded warm-up are used per condition; points show medians and P25–P75. The prepared hierarchy is reused, while viewport selection and retrieval use the evaluated PhyloLens server path. Conditions are independent viewport windows, so points are not connected.",
        connect=False,
    )
    pacing = aggregate(
        replay,
        lambda r: quantile(r["frame_intervals_ms"], 0.95),
        lambda r: r["response"]["expected_primitive_count"],
        lambda r: (
            "Explicit node-and-edge representation"
            if r["condition"].startswith("detail-")
            else "Collapsed-subtree representation"
        ),
    )
    renderer.curves(
        "F2d-rq2-frame-pacing",
        pacing,
        "Rendering workload (log scale)",
        "95th percentile frame interval (ms)",
        "RQ2 frame pacing during the fixed post-load interaction window. Each measured run contributes its own 95th-percentile frame interval; points and whiskers summarize five runs by median and P25–P75 without pooling frames. One warm-up is excluded. The horizontal axis is logarithmic; measured frame intervals are not used to infer the physical display refresh rate.",
        logx=True,
        connect=False,
    )
    frame_rows = []
    for r in replay + integrated:
        frames = r["frame_intervals_ms"]
        if frames:
            frame_rows.append(
                dict(
                    campaign=r["campaign"],
                    condition=r["condition"],
                    repetition=r["repetition"],
                    count=len(frames),
                    median_ms=median(frames),
                    p95_ms=quantile(frames, 0.95),
                    maximum_ms=max(frames),
                    above_50ms_count=sum(f > 50 for f in frames),
                    above_50ms_proportion=sum(f > 50 for f in frames) / len(frames),
                )
            )
    with (output / "frame-pacing-observations.csv").open("w", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=list(frame_rows[0]))
        writer.writeheader()
        writer.writerows(frame_rows)
    rq3 = read(paths["rq3"] / "rq3.json")
    original_nodes = rq3[-1]["representations"]
    original_edges = rq3[-1]["edges"]
    fig, ax = renderer.axes(6.4)
    rows = []
    for i, (key, label, denominator) in enumerate(
        [
            ("representations", "Node representations", original_nodes),
            ("edges", "Edges between represented regions", original_edges),
        ]
    ):
        values = [100 * r[key] / denominator for r in rq3]
        ax.barh(
            [r["level"] + (i - 0.5) * 0.34 for r in rq3],
            values,
            height=0.32,
            label=label,
            color=COLORS[i],
        )
        rows += [
            dict(
                level=r["level"],
                hop_depth=r["hop_depth"],
                series=label,
                percentage=v,
                raw_count=r[key],
                invariants=r["invariants"],
            )
            for r, v in zip(rq3, values)
        ]
    ax.set_yticks(
        [r["level"] for r in rq3],
        [f"L{r['level']} (d={r['hop_depth']})" for r in rq3],
    )
    ax.invert_yaxis()
    ax.set_xlabel("Representation size relative to the original tree (%)")
    ax.set_ylabel("LoD level (tree-depth cut d)")
    ax.set_xlim(0, 105)
    ax.legend(frameon=False, loc="upper center", bbox_to_anchor=(0.5, 1.12), ncol=2)
    renderer.save(
        fig,
        "F3-rq3-lod-effectiveness",
        rows,
        "RQ3 deterministic evaluation of all 15 LoD levels for the 100,000-node tree. Node-representation counts are normalized by the 100,000 original nodes and inter-region edge counts by the 99,999 original tree edges. Every level covers all original nodes, and all membership, connectivity, refinement, coordinate, and weighted-edge checks passed. Tree-depth cuts are construction parameters of the visualization hierarchy and do not represent evolutionary distances.",
    )
    order = [
        "collapse-small",
        "collapse-medium",
        "collapse-large",
        "expand-small",
        "expand-medium",
        "expand-large",
        "navigation",
    ]
    labels = [
        (
            f"{c.split('-')[0].capitalize()} — {dict(small='2', medium='88', large='3,796')[c.split('-')[1]]} tree nodes"
            if "-" in c
            else "Navigation"
        )
        for c in order
    ]
    action_rows = aggregate(
        actions,
        lambda r: r["timing"]["interaction_display_ms"],
        lambda r: order.index(r["condition"]),
        lambda r: "PhyloLens",
    )
    renderer.curves(
        "F4-rq4-interaction-responsiveness",
        action_rows,
        "Interaction time (ms; log scale)",
        "",
        "RQ4 interaction-to-display latency for navigation and explicit subtree expansion/collapse. Seven measured runs and one excluded warm-up are used per scenario; preparation and target setup are outside the measured interval. Points show medians and P25–P75 on a logarithmic time axis. The intermediate target contains 88 original tree nodes and is selected deterministically between the retained small and large cases.",
        logx=True,
        horizontal_labels=labels,
        connect=False,
    )
    phases = [
        ("input_to_request_ms", "Input→request"),
        ("http_interval_ms", "HTTP"),
        ("response_to_snapshot_ms", "Response→graph update"),
        ("input_to_snapshot_ms", "Input→graph update"),
        ("snapshot_to_two_raf_ms", "Graph update→display"),
    ]
    fig, ax = renderer.axes(6.3)
    rows = []
    for i, (metric, label) in enumerate(phases):
        data = aggregate(
            actions,
            lambda r: r["timing"].get(metric),
            lambda r: order.index(r["condition"]),
            lambda r: label,
        )
        for row in data:
            row["y_offset"] = row["x"] + (i - 2) * 0.12
        ax.errorbar(
            [r["median"] for r in data],
            [r["y_offset"] for r in data],
            xerr=[
                [r["median"] - r["p25"] for r in data],
                [r["p75"] - r["median"] for r in data],
            ],
            fmt=MARKERS[i],
            markersize=3.4,
            capsize=3,
            elinewidth=1.1,
            color=COLORS[i],
            label=label,
        )
        rows += data
    ax.set_xscale("log")
    ax.set_yticks(range(len(order)), labels)
    ax.invert_yaxis()
    ax.set_xlabel("Interaction phase time (ms; log scale)")
    ax.legend(frameon=False, loc="upper center", bbox_to_anchor=(0.5, 1.23), ncol=2)
    renderer.save(
        fig,
        "F4b-rq4-phase-decomposition",
        rows,
        "RQ4 phase decomposition from seven measured runs per scenario; one warm-up is excluded. Collapse requires no server request and therefore has no HTTP interval. Input-to-graph-update is an enclosing interval for locally applied state changes, so phase medians are shown independently and must not be summed. The time axis is logarithmic.",
    )
    external = read(paths["external"] / "summary.json")["cells"]
    external_rows = [
        dict(
            condition=f"{r['tool']}-{r['nodes']}",
            x=r["nodes"] / 1000,
            series={
                "phylolens": "PhyloLens",
                "phylotree": "Phylotree.js",
                "taxonium": "Taxonium",
            }[r["tool"]],
            n=r["success"],
            median=r["median_ms"] / 1000,
            p25=r["p25_ms"] / 1000,
            p75=r["p75_ms"] / 1000,
        )
        for r in external
        if r["success"]
    ]
    renderer.curves(
        "F5-external-first-visualization",
        external_rows,
        "Tree size (×10³ nodes; log scale)",
        "Time to first visualization (s; log scale)",
        "Comparison of time to first visualization using each tool's native visualization path. Three measured runs and one excluded warm-up are used per tool and tree size; points show medians and P25–P75, with both axes logarithmic. The tools use architecture-specific criteria for the first valid visual output, so the measurements do not imply equivalent full-tree rendering or identical amounts of displayed detail.",
        logx=True,
        logy=True,
        size_ticks=True,
    )
    msagl = []
    with (paths["msagl"] / "msagl-paired-observations.csv").open() as stream:
        msagl = list(csv.DictReader(stream))
    successful = [
        r
        for r in msagl
        if r["state"] == "success" and r["included_in_timing_summary"].lower() == "true"
    ]
    mrows = []
    for metric, label in [
        ("total_s", "MSAGLJS — adapted input to prepared tiles"),
        (
            "processing_excluding_input_construction_s",
            "MSAGLJS — excluding input construction",
        ),
    ]:
        grouped = defaultdict(list)
        for row in successful:
            total, parse, processing = map(
                float,
                [
                    row["total_s"],
                    row["parse_s"],
                    row["processing_excluding_input_construction_s"],
                ],
            )
            assert (
                abs(total - parse - processing) < 1e-8
            ), "MSAGL processing must be a paired difference."
            grouped[int(row["node_count"])].append(float(row[metric]))
        mrows += [
            dict(condition=str(n), x=n / 1000, series=label, **statistics(vals))
            for n, vals in sorted(grouped.items())
        ]
    timeout = [
        r for r in msagl if r["state"] == "timeout" and int(r["node_count"]) == 100000
    ]
    censor = (
        dict(x=100, y=300, label=f"MSAGLJS 100k: {len(timeout)}/5 timed out at 300 s")
        if timeout
        else None
    )
    comparative = [dict(r) for r in rq1_time if r["x"] <= 100] + mrows
    renderer.curves(
        "F6-msagljs-fullmst-comparison",
        comparative,
        "Tree size (×10³ nodes)",
        "Preparation / processing time (s; log scale)",
        "Architectural comparison of PhyloLens preparation and the retained MSAGLJS TileMap preparation baseline. MSAGLJS is reported both from adapted edge-list input to prepared tiles and with input decoding/native graph construction excluded. Five measured runs are summarized by medians and P25–P75; warm-ups are excluded and the vertical axis is logarithmic. Newick adaptation and first rendered visualization were not measured for MSAGLJS, and layout equivalence is not assumed. The open triangle marks the 300 s timeout condition rather than a successful timing.",
        logy=True,
        size_ticks=True,
        censor=censor,
    )
    parse_rows = aggregate(
        [dict(r, condition=r["node_count"]) for r in successful],
        lambda r: float(r["parse_s"]),
        lambda r: int(r["node_count"]) / 1000,
        lambda r: "MSAGLJS input construction",
    )
    renderer.curves(
        "F6b-msagljs-input-construction",
        parse_rows,
        "Tree size (×10³ nodes)",
        "Input decoding and graph construction time (s)",
        "MSAGLJS edge-list decoding and native graph construction. Five successful measured runs per completed tree size are summarized by medians and P25–P75; warm-ups are excluded. The 100,000-node condition is omitted because all measured runs reached the timeout before a completed phase measurement was available.",
        size_ticks=True,
    )
    manifest = dict(
        product_fingerprint=fingerprint,
        python=platform.python_version(),
        matplotlib=renderer.plt.matplotlib.__version__,
        generator_sha256=sha256(Path(__file__)),
        source_sha256=sources,
        figures=renderer.records,
        interpretation="RQ1/RQ2/RQ3/RQ4/external use the audited current evidence; MSAGLJS is retained as an architectural baseline.",
    )
    (output / "FIGURES_MANIFEST.json").write_text(json.dumps(manifest, indent=2) + "\n")
    (output / "CAPTIONS.md").write_text(
        "\n\n".join(f"## {r['stem']}\n\n{r['caption']}" for r in renderer.records)
        + "\n"
    )

    def latex_escape(text):
        for old, new in [
            ("&", r"\&"),
            ("%", r"\%"),
            ("_", r"\_"),
            ("→", r"$\rightarrow$"),
            ("–", "--"),
        ]:
            text = text.replace(old, new)
        return text

    snippets = []
    for r in renderer.records:
        snippets.append(
            "\\begin{figure}[htbp]\n\\centering\n\\includegraphics[width=\\linewidth]{Images/"
            + r["stem"]
            + ".pdf}\n\\caption{"
            + latex_escape(r["caption"])
            + "}\n\\label{fig:"
            + r["stem"]
            + "}\n\\end{figure}"
        )
    (output / "CAPTIONS.tex").write_text("\n\n".join(snippets) + "\n")
    print(
        json.dumps(
            dict(
                output=str(output.resolve()),
                figures=len(renderer.records),
                product_fingerprint=fingerprint,
            )
        )
    )
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--root",
        type=Path,
        default=ROOT,
        help="Repository or extracted evidence-bundle root.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("eval/results/derived/chapter5-figures-current"),
    )
    parser.add_argument("--dpi", type=int, default=220)
    args = parser.parse_args()
    root = args.root.resolve()
    output = (
        args.output_dir if args.output_dir.is_absolute() else root / args.output_dir
    )
    os.environ.setdefault("MPLCONFIGDIR", str(output / "matplotlib-cache"))
    try:
        generate({k: root / v for k, v in PATHS.items()}, output, args.dpi)
    except (AssertionError, KeyError, FileNotFoundError, ValueError) as error:
        parser.exit(1, f"Figure generation aborted: {error}\n")


if __name__ == "__main__":
    main()
