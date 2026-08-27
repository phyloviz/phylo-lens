"""Render traceable final-publication figures and tables from consolidation.

The renderer reads only the reconciled consolidated directory (and does not
read raw observations).  It makes no scientific inference: figures display
retained medians and P25--P75 intervals, while tables are deterministic
formatting of the corresponding consolidated values.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import shutil
import subprocess
import tempfile
import xml.etree.ElementTree as element_tree
from pathlib import Path
from typing import Any
from xml.sax.saxutils import escape

PRODUCT_COMMIT = "cbb78f5e74b37e4fb480c0416e614e27e6f67ed9"
CONSOLIDATION_COMMIT = "5e7090add3a9a5ef2c0ae3cdc3ea4ee6192ab2f4"
SOURCE_DIRECTORY = "eval/results/derived/consolidated-final-v020"
SVG_NS = "http://www.w3.org/2000/svg"
COLORS = ("#1b6ca8", "#c45b21", "#3d7d4a", "#6b4f9b")
DASHES = ("", "8 4", "2 3", "10 3 2 3")
MARKERS = ("circle", "square", "diamond", "triangle")


def repository_root() -> Path:
    return Path(__file__).resolve().parents[3]


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8", newline="") as stream:
        return list(csv.DictReader(stream))


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def write_text(path: Path, contents: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(contents, encoding="utf-8")


def write_json(path: Path, payload: Any) -> None:
    write_text(path, json.dumps(payload, indent=2, sort_keys=True) + "\n")


def number(value: str | int | float | None) -> float | None:
    if value in (None, ""):
        return None
    return float(value)


def ms_to_seconds(value: str | int | float) -> float:
    return float(value) / 1000.0


def bytes_to_gib(value: str | int | float) -> float:
    return float(value) / (1024.0**3)


def fmt(value: float | int | None, precision: int = 2) -> str:
    if value is None:
        return "N/A"
    if abs(float(value)) >= 1000:
        return f"{float(value):,.0f}"
    return f"{float(value):.{precision}f}"


def latex(value: str) -> str:
    escaped = (
        value.replace("\\", r"\textbackslash{}")
        .replace("&", r"\&")
        .replace("%", r"\%")
        .replace("_", r"\_")
        .replace("#", r"\#")
    )
    return (
        escaped.replace("τ", r"\ensuremath{\tau}")
        .replace("→", r"\ensuremath{\to}")
        .replace("Δ", r"\ensuremath{\Delta}")
        .replace("×", r"\ensuremath{\times}")
        .replace("–", "--")
    )


def svg_document(width: int, height: int, title: str, body: list[str]) -> str:
    return "\n".join(
        [
            f'<svg xmlns="{SVG_NS}" width="{width}" height="{height}" viewBox="0 0 {width} {height}" role="img" aria-labelledby="title desc">',
            f'<title id="title">{escape(title)}</title>',
            '<desc id="desc">Medians shown with P25--P75 intervals from reconciled authoritative evidence.</desc>',
            "<style>text{font-family:Arial,Helvetica,sans-serif;fill:#1f2933}.title{font-size:22px;font-weight:700}.subtitle{font-size:13px}.axis{font-size:12px}.axis-title{font-size:14px;font-weight:600}.legend{font-size:13px}.note{font-size:12px}.frame{fill:none;stroke:#334e68;stroke-width:1}.grid{stroke:#d9e2ec;stroke-width:1}.series{fill:none;stroke-width:2.4}.interval{stroke-width:2}.marker{stroke:#1f2933;stroke-width:1}</style>",
            f'<rect width="{width}" height="{height}" fill="#ffffff"/>',
            *body,
            "</svg>",
        ]
    )


def marker(shape: str, x: float, y: float, color: str) -> str:
    if shape == "circle":
        return (
            f'<circle class="marker" cx="{x:.2f}" cy="{y:.2f}" r="4.1" fill="{color}"/>'
        )
    if shape == "square":
        return f'<rect class="marker" x="{x - 4:.2f}" y="{y - 4:.2f}" width="8" height="8" fill="{color}"/>'
    if shape == "diamond":
        return f'<path class="marker" d="M{x:.2f},{y - 5:.2f} L{x + 5:.2f},{y:.2f} L{x:.2f},{y + 5:.2f} L{x - 5:.2f},{y:.2f} Z" fill="{color}"/>'
    return f'<path class="marker" d="M{x:.2f},{y - 5:.2f} L{x + 5:.2f},{y + 4:.2f} L{x - 5:.2f},{y + 4:.2f} Z" fill="{color}"/>'


def scale(
    value: float, lower: float, upper: float, start: float, end: float, *, log: bool
) -> float:
    if log:
        value, lower, upper = math.log10(value), math.log10(lower), math.log10(upper)
    return start + (value - lower) * (end - start) / (upper - lower)


def padded_domain(values: list[float], *, log: bool) -> tuple[float, float]:
    lower, upper = min(values), max(values)
    if log:
        return lower / 1.35, upper * 1.35
    span = upper - lower or max(abs(upper), 1.0)
    return max(0.0, lower - span * 0.12), upper + span * 0.12


def linear_ticks(lower: float, upper: float, count: int = 5) -> list[float]:
    raw_step = (upper - lower) / max(count - 1, 1)
    magnitude = 10 ** math.floor(math.log10(raw_step))
    fraction = raw_step / magnitude
    nice_fraction = next(value for value in (1, 2, 2.5, 5, 10) if fraction <= value)
    step = nice_fraction * magnitude
    start = 0.0 if lower <= step * 0.1 else math.ceil(lower / step) * step
    stop = math.floor(upper / step) * step
    return [
        start + step * index for index in range(int(round((stop - start) / step)) + 1)
    ]


def log_ticks(lower: float, upper: float) -> list[float]:
    values: list[float] = []
    for exponent in range(
        math.floor(math.log10(lower)), math.ceil(math.log10(upper)) + 1
    ):
        for multiplier in (1, 2, 5):
            value = multiplier * 10**exponent
            if lower <= value <= upper:
                values.append(float(value))
    return values


def tick_label(value: float, *, seconds: bool = False, gib: bool = False) -> str:
    if seconds:
        return f"{value:g}"
    if gib:
        return f"{value:g}"
    if value >= 1000:
        return f"{value / 1000:g}k"
    return f"{value:g}"


def draw_xy_panel(
    body: list[str],
    *,
    x: float,
    y: float,
    width: float,
    height: float,
    title: str,
    x_label: str,
    y_label: str,
    groups: dict[str, list[dict[str, float]]],
    x_log: bool,
    y_log: bool,
    x_ticks: list[float] | None = None,
    y_label_kind: str = "number",
) -> None:
    left, right, top, bottom = 72.0, 20.0, 40.0, 64.0
    px0, px1, py0, py1 = x + left, x + width - right, y + top, y + height - bottom
    xs = [item["x"] for rows in groups.values() for item in rows]
    ys = [
        value
        for rows in groups.values()
        for item in rows
        for value in (item["lo"], item["hi"])
    ]
    xmin, xmax = padded_domain(xs, log=x_log)
    ymin, ymax = padded_domain(ys, log=y_log)
    x_ticks = x_ticks or (log_ticks(xmin, xmax) if x_log else linear_ticks(xmin, xmax))
    y_ticks = log_ticks(ymin, ymax) if y_log else linear_ticks(ymin, ymax)
    body.extend(
        [
            f'<text class="title" x="{x}" y="{y + 22}">{escape(title)}</text>',
            f'<rect class="frame" x="{px0}" y="{py0}" width="{px1 - px0}" height="{py1 - py0}"/>',
        ]
    )
    for value in y_ticks:
        yy = scale(value, ymin, ymax, py1, py0, log=y_log)
        body.extend(
            [
                f'<line class="grid" x1="{px0}" x2="{px1}" y1="{yy:.2f}" y2="{yy:.2f}"/>',
                f'<text class="axis" text-anchor="end" x="{px0 - 8}" y="{yy + 4:.2f}">{tick_label(value, seconds=y_label_kind == "seconds", gib=y_label_kind == "gib")}</text>',
            ]
        )
    for value in x_ticks:
        xx = scale(value, xmin, xmax, px0, px1, log=x_log)
        body.extend(
            [
                f'<line class="grid" x1="{xx:.2f}" x2="{xx:.2f}" y1="{py0}" y2="{py1}"/>',
                f'<text class="axis" text-anchor="middle" x="{xx:.2f}" y="{py1 + 19}">{tick_label(value)}</text>',
            ]
        )
    body.extend(
        [
            f'<text class="axis-title" text-anchor="middle" x="{(px0 + px1) / 2:.2f}" y="{y + height - 12}">{escape(x_label)}</text>',
            f'<text class="axis-title" text-anchor="middle" transform="translate({x + 18},{(py0 + py1) / 2:.2f}) rotate(-90)">{escape(y_label)}</text>',
        ]
    )
    for index, (name, rows) in enumerate(groups.items()):
        color, dash, shape = COLORS[index], DASHES[index], MARKERS[index]
        ordered = sorted(rows, key=lambda row: row["x"])
        points = []
        for row in ordered:
            xx = scale(row["x"], xmin, xmax, px0, px1, log=x_log)
            yy = scale(row["median"], ymin, ymax, py1, py0, log=y_log)
            lo = scale(row["lo"], ymin, ymax, py1, py0, log=y_log)
            hi = scale(row["hi"], ymin, ymax, py1, py0, log=y_log)
            body.append(
                f'<line class="interval" stroke="{color}" x1="{xx:.2f}" x2="{xx:.2f}" y1="{lo:.2f}" y2="{hi:.2f}"/>'
            )
            body.append(
                f'<line class="interval" stroke="{color}" x1="{xx - 4:.2f}" x2="{xx + 4:.2f}" y1="{lo:.2f}" y2="{lo:.2f}"/>'
            )
            body.append(
                f'<line class="interval" stroke="{color}" x1="{xx - 4:.2f}" x2="{xx + 4:.2f}" y1="{hi:.2f}" y2="{hi:.2f}"/>'
            )
            points.append(f"{xx:.2f},{yy:.2f}")
        body.append(
            f'<polyline class="series" stroke="{color}" stroke-dasharray="{dash}" points="{" ".join(points)}"/>'
        )
        for row in ordered:
            xx = scale(row["x"], xmin, xmax, px0, px1, log=x_log)
            yy = scale(row["median"], ymin, ymax, py1, py0, log=y_log)
            body.append(marker(shape, xx, yy, color))
        lx = x + 8 + index * 135
        ly = y + 34
        body.append(
            f'<line class="series" stroke="{color}" stroke-dasharray="{dash}" x1="{lx}" x2="{lx + 22}" y1="{ly}" y2="{ly}"/>'
        )
        body.append(marker(shape, lx + 11, ly, color))
        body.append(
            f'<text class="legend" x="{lx + 28}" y="{ly + 4}">{escape(name)}</text>'
        )


def figure_f1(rows: list[dict[str, str]]) -> str:
    groups: dict[str, list[dict[str, float]]] = {}
    memory: dict[str, list[dict[str, float]]] = {}
    names = {
        "balanced": "Balanced",
        "caterpillar": "Caterpillar",
        "irregular": "Irregular (seed 2026)",
    }
    for row in rows:
        name = names[row["topology"]]
        groups.setdefault(name, []).append(
            {
                "x": float(row["parsed_nodes"]),
                "lo": ms_to_seconds(row["preparation_ms_p25"]),
                "median": ms_to_seconds(row["preparation_ms_median"]),
                "hi": ms_to_seconds(row["preparation_ms_p75"]),
            }
        )
        memory.setdefault(name, []).append(
            {
                "x": float(row["parsed_nodes"]),
                "lo": bytes_to_gib(row["peak_rss_bytes_p25"]),
                "median": bytes_to_gib(row["peak_rss_bytes_median"]),
                "hi": bytes_to_gib(row["peak_rss_bytes_p75"]),
            }
        )
    body: list[str] = [
        '<text class="title" x="38" y="34">RQ1 — preparation scalability</text>',
        '<text class="subtitle" x="38" y="55">Medians with P25–P75 intervals; both axes use logarithmic scaling.</text>',
    ]
    nodes = [9999, 19999, 49999, 99999]
    draw_xy_panel(
        body,
        x=30,
        y=75,
        width=570,
        height=510,
        title="A. Server-side preparation",
        x_label="Source graph nodes (log scale)",
        y_label="Preparation time (s; log scale)",
        groups=groups,
        x_log=True,
        y_log=True,
        x_ticks=nodes,
        y_label_kind="seconds",
    )
    draw_xy_panel(
        body,
        x=620,
        y=75,
        width=570,
        height=510,
        title="B. Peak process-tree RSS",
        x_label="Source graph nodes (log scale)",
        y_label="Peak RSS (GiB; log scale)",
        groups=memory,
        x_log=True,
        y_log=True,
        x_ticks=nodes,
        y_label_kind="gib",
    )
    return svg_document(1220, 610, "RQ1 preparation scalability", body)


def figure_f2(rows: list[dict[str, str]]) -> str:
    names = {"detail": "Detail fixture", "triangle_control": "Triangle fixture"}
    groups: dict[str, list[dict[str, float]]] = {}
    for row in rows:
        groups.setdefault(names[row["family"]], []).append(
            {
                "x": float(row["primitive_count"]),
                "lo": float(row["client_first_visualization_ms_p25"]),
                "median": float(row["client_first_visualization_ms_median"]),
                "hi": float(row["client_first_visualization_ms_p75"]),
            }
        )
    body = [
        '<text class="title" x="38" y="34">RQ2 — isolated client visualization scalability</text>',
        '<text class="subtitle" x="38" y="55">Frozen replay path after fixture delivery; medians with P25–P75 intervals.</text>',
    ]
    draw_xy_panel(
        body,
        x=100,
        y=80,
        width=960,
        height=500,
        title="Client first-visualization latency",
        x_label="Materialized primitives (log scale)",
        y_label="First visualization (ms)",
        groups=groups,
        x_log=True,
        y_log=False,
        x_ticks=[1000, 5000, 10000, 20000, 40000],
    )
    return svg_document(1160, 610, "RQ2 client visualization scalability", body)


def draw_bar_panel(
    body: list[str],
    *,
    x: float,
    y: float,
    width: float,
    height: float,
    title: str,
    values: list[tuple[str, float]],
    y_label: str,
    color: str,
) -> None:
    px0, px1, py0, py1 = x + 65, x + width - 20, y + 42, y + height - 65
    body.extend(
        [
            f'<text class="title" x="{x}" y="{y + 22}">{escape(title)}</text>',
            f'<rect class="frame" x="{px0}" y="{py0}" width="{px1 - px0}" height="{py1 - py0}"/>',
        ]
    )
    for value in range(0, 101, 25):
        yy = py1 - value / 100 * (py1 - py0)
        body.extend(
            [
                f'<line class="grid" x1="{px0}" x2="{px1}" y1="{yy:.2f}" y2="{yy:.2f}"/>',
                f'<text class="axis" text-anchor="end" x="{px0 - 8}" y="{yy + 4:.2f}">{value}%</text>',
            ]
        )
    step = (px1 - px0) / len(values)
    for index, (label, value) in enumerate(values):
        left = px0 + index * step + step * 0.2
        bar_width = step * 0.6
        top = py1 - value / 100 * (py1 - py0)
        body.append(
            f'<rect x="{left:.2f}" y="{top:.2f}" width="{bar_width:.2f}" height="{py1 - top:.2f}" fill="{color}" stroke="#1f2933" stroke-width="1"/>'
        )
        body.append(
            f'<text class="axis" text-anchor="middle" x="{left + bar_width / 2:.2f}" y="{top - 7:.2f}">{value:.1f}</text>'
        )
        body.append(
            f'<text class="axis" text-anchor="middle" x="{left + bar_width / 2:.2f}" y="{py1 + 18}">{escape(label)}</text>'
        )
    body.append(
        f'<text class="axis-title" text-anchor="middle" transform="translate({x + 17},{(py0 + py1) / 2:.2f}) rotate(-90)">{escape(y_label)}</text>'
    )


def figure_f3(rows: list[dict[str, str]]) -> str:
    labels = [f"L{row['lod_level']}\nτ={row['threshold']}" for row in rows]
    materialized = [
        (label.replace("\n", " "), float(row["materialization_ratio"]) * 100)
        for label, row in zip(labels, rows, strict=True)
    ]
    reduction = [
        (label.replace("\n", " "), float(row["primitive_reduction_ratio"]) * 100)
        for label, row in zip(labels, rows, strict=True)
    ]
    body = [
        '<text class="title" x="38" y="34">RQ3 — persisted LoD effectiveness</text>',
        '<text class="subtitle" x="38" y="55">All three persisted levels represent all 13,075 source nodes; bars show materialization, not represented-node coverage.</text>',
    ]
    draw_bar_panel(
        body,
        x=30,
        y=80,
        width=570,
        height=440,
        title="A. Materialized visual-node ratio",
        values=materialized,
        y_label="Visual nodes / source nodes (%)",
        color=COLORS[0],
    )
    draw_bar_panel(
        body,
        x=620,
        y=80,
        width=570,
        height=440,
        title="B. Primitive reduction from full detail",
        values=reduction,
        y_label="Primitive reduction (%)",
        color=COLORS[2],
    )
    return svg_document(1220, 550, "RQ3 LoD effectiveness", body)


def figure_f4(rows: list[dict[str, str]]) -> str:
    order = [
        "navigation",
        "expand-low",
        "collapse-low",
        "expand-representative",
        "collapse-representative",
        "expand-high",
        "collapse-high",
    ]
    data = {row["scenario"]: row for row in rows}
    values = [data[name] for name in order]
    left, right, top, bottom = 230, 45, 72, 55
    width, height = 1120, 510
    px0, px1, py0, py1 = left, width - right, top, height - bottom
    max_value = max(float(row["settle_latency_ms_p75"]) for row in values) * 1.15
    body = [
        '<text class="title" x="38" y="34">RQ4 — browser-observed interaction settle latency</text>',
        '<text class="subtitle" x="38" y="55">Medians with P25–P75 intervals; no display-completeness threshold is implied.</text>',
        f'<rect class="frame" x="{px0}" y="{py0}" width="{px1 - px0}" height="{py1 - py0}"/>',
    ]
    for value in linear_ticks(0, max_value):
        xx = scale(value, 0, max_value, px0, px1, log=False)
        body.extend(
            [
                f'<line class="grid" x1="{xx:.2f}" x2="{xx:.2f}" y1="{py0}" y2="{py1}"/>',
                f'<text class="axis" text-anchor="middle" x="{xx:.2f}" y="{py1 + 19}">{value:.0f}</text>',
            ]
        )
    step = (py1 - py0) / len(values)
    for index, row in enumerate(values):
        yy = py0 + (index + 0.5) * step
        lo, median, hi = (
            float(row[key])
            for key in (
                "settle_latency_ms_p25",
                "settle_latency_ms_median",
                "settle_latency_ms_p75",
            )
        )
        xlo, xmid, xhi = (
            scale(value, 0, max_value, px0, px1, log=False)
            for value in (lo, median, hi)
        )
        body.extend(
            [
                f'<line class="interval" stroke="{COLORS[0]}" x1="{xlo:.2f}" x2="{xhi:.2f}" y1="{yy:.2f}" y2="{yy:.2f}"/>',
                f'<line class="interval" stroke="{COLORS[0]}" x1="{xlo:.2f}" x2="{xlo:.2f}" y1="{yy - 4:.2f}" y2="{yy + 4:.2f}"/>',
                f'<line class="interval" stroke="{COLORS[0]}" x1="{xhi:.2f}" x2="{xhi:.2f}" y1="{yy - 4:.2f}" y2="{yy + 4:.2f}"/>',
                marker("circle", xmid, yy, COLORS[0]),
                f'<text class="axis" text-anchor="end" x="{px0 - 12}" y="{yy + 4:.2f}">{escape(row["scenario"])}</text>',
            ]
        )
    body.append(
        f'<text class="axis-title" text-anchor="middle" x="{(px0 + px1) / 2:.2f}" y="{height - 12}">Browser-observed settle latency (ms)</text>'
    )
    return svg_document(width, height, "RQ4 interaction responsiveness", body)


def figure_f5(rows: list[dict[str, str]]) -> str:
    names = {
        "phylolens": "PhyloLens v0.2.0",
        "taxonium": "Taxonium",
        "phylotree": "Phylotree",
    }
    groups: dict[str, list[dict[str, float]]] = {}
    for row in rows:
        groups.setdefault(names[row["tool_id"]], []).append(
            {
                "x": float(row["dataset_id"].rsplit("-", 1)[1]),
                "lo": ms_to_seconds(row["p25_ms"]),
                "median": ms_to_seconds(row["median_ms"]),
                "hi": ms_to_seconds(row["p75_ms"]),
            }
        )
    body = [
        '<text class="title" x="38" y="34">External comparison — native-path first meaningful visual time</text>',
        '<text class="subtitle" x="38" y="55">Different system architectures; medians with P25–P75 intervals. Both axes use logarithmic scaling.</text>',
    ]
    draw_xy_panel(
        body,
        x=100,
        y=80,
        width=980,
        height=500,
        title="Reconciled authoritative comparison",
        x_label="Dataset size (leaves; log scale)",
        y_label="First meaningful visual time (s; log scale)",
        groups=groups,
        x_log=True,
        y_log=True,
        x_ticks=[12500, 25000, 50000, 100000, 200000],
        y_label_kind="seconds",
    )
    return svg_document(1180, 610, "External native-path comparison", body)


def export_figure(svg: str, output: Path, stem: str) -> list[Path]:
    svg_path = output / "figures" / f"{stem}.svg"
    pdf_path = output / "figures" / f"{stem}.pdf"
    png_path = output / "figures" / f"{stem}.png"
    write_text(svg_path, svg)
    subprocess.run(
        ["rsvg-convert", "-f", "pdf", "-o", str(pdf_path), str(svg_path)], check=True
    )
    subprocess.run(
        ["rsvg-convert", "-f", "png", "-w", "2400", "-o", str(png_path), str(svg_path)],
        check=True,
    )
    return [svg_path, pdf_path, png_path]


def table_tex(
    headers: list[str], rows: list[list[str]], *, note: str | None = None
) -> str:
    alignment = "l" + "r" * (len(headers) - 1)
    lines = [
        f"\\begin{{tabular}}{{{alignment}}}",
        "\\hline",
        " & ".join(latex(header) for header in headers) + r" \\",
        "\\hline",
    ]
    lines.extend(" & ".join(latex(cell) for cell in row) + r" \\" for row in rows)
    lines.extend(["\\hline", "\\end{tabular}"])
    if note:
        lines.extend(["", r"\par\smallskip", r"\footnotesize " + latex(note)])
    return "\n".join(lines) + "\n"


def render_tables(
    source: Path, output: Path
) -> dict[str, tuple[Path, list[Path], str, list[str], list[str]]]:
    rq1 = read_csv(source / "rq1-condition-metrics.csv")
    rq2_latency = read_csv(source / "rq2-first-visualization-summary.csv")
    rq2_memory = {
        row["condition_id"]: row for row in read_csv(source / "rq2-memory-summary.csv")
    }
    rq2_frames = {
        row["condition_id"]: row for row in read_csv(source / "rq2-frame-summary.csv")
    }
    rq3 = read_csv(source / "rq3-lod-reduction.csv")
    rq4 = read_csv(source / "rq4-condition-metrics.csv")
    rq4_frames = read_csv(source / "rq4-frame-summary.csv")
    msagl = read_csv(source / "msagljs-condition-metrics.csv")
    comparison = read_csv(source / "phylolens-vs-msagljs-descriptive-comparison.csv")
    semantic_pass = "PASS (membership; position; quotient)"
    tables: dict[str, tuple[Path, list[Path], str, list[str], list[str]]] = {}

    t1_rows = [
        [
            f"L{row['lod_level']} (τ={row['threshold']})",
            row["materialized_visual_nodes"],
            row["materialized_edges"],
            row["triangle_proxy_count"],
            row["represented_source_nodes"],
            f"{float(row['materialization_ratio']) * 100:.2f}%",
            f"{float(row['primitive_reduction_ratio']) * 100:.2f}%",
            semantic_pass,
        ]
        for row in rq3
    ]
    tables["T1"] = (
        output / "tables" / "T1-rq3-lod-fidelity.tex",
        [source / "rq3-lod-reduction.csv", source / "rq3-semantic-fidelity.json"],
        table_tex(
            [
                "Level / threshold",
                "Visual V",
                "Visual E",
                "Aggregates",
                "Represented source nodes",
                "Materialized ratio",
                "Primitive reduction",
                "Semantic fidelity",
            ],
            t1_rows,
            note="All persisted levels represent all 13,075 source nodes.",
        ),
        ["Exact persisted LoD structural metrics and semantic-fidelity ledger."],
        [],
    )

    rq4_order = [
        "navigation",
        "expand-low",
        "collapse-low",
        "expand-representative",
        "collapse-representative",
        "expand-high",
        "collapse-high",
    ]
    rq4_by = {row["scenario"]: row for row in rq4}
    t2_rows: list[list[str]] = []
    for scenario in rq4_order:
        row = rq4_by[scenario]
        collapse = scenario.startswith("collapse")
        members = row["represented_member_count"] or "N/A"
        http = "N/A" if collapse else f"{fmt(number(row['browser_http_ms_median']))}"
        transition = f"{row['pre_materialized_nodes']}/{row['pre_materialized_edges']} → {row['post_materialized_nodes']}/{row['post_materialized_edges']}"
        truncation = f"{row['truncated_response_count']}/{row['success_count']}"
        t2_rows.append(
            [
                scenario,
                members,
                f"{fmt(number(row['settle_latency_ms_median']))}",
                f"{fmt(number(row['settle_latency_ms_iqr']))}",
                http,
                f"{fmt(number(row['event_to_snapshot_ms_median']))} / {fmt(number(row['snapshot_to_settle_ms_median']))}",
                transition,
                truncation,
            ]
        )
    tables["T2"] = (
        output / "tables" / "T2-rq4-interaction-summary.tex",
        [source / "rq4-condition-metrics.csv"],
        table_tex(
            [
                "Scenario",
                "Represented members",
                "Settle median (ms)",
                "IQR (ms)",
                "HTTP median (ms)",
                "Event→snapshot / snapshot→settle (ms)",
                "Materialized V/E",
                "Truncated",
            ],
            t2_rows,
            note="Collapse scenarios issue zero measured viewport requests; HTTP is therefore N/A. Represented members are source members, not rendered nodes.",
        ),
        ["Browser-observed settle latency and retained interaction phase summaries."],
        [],
    )

    paired: dict[tuple[str, str], dict[str, dict[str, str]]] = {}
    for row in comparison:
        paired.setdefault((row["topology"], row["requested_leaves"]), {})[
            row["system"]
        ] = row
    t3_rows = []
    for (topology, leaves), systems in sorted(
        paired.items(), key=lambda item: (item[0][0], int(item[0][1]))
    ):
        phylo, msagl_row = systems["PhyloLens"], systems["MSAGLJS"]
        t3_rows.append(
            [
                topology,
                leaves,
                f"{fmt(number(phylo['native_preparation_median_ms']))} [{fmt(number(phylo['native_preparation_p25_ms']))}–{fmt(number(phylo['native_preparation_p75_ms']))}]",
                f"{fmt(number(msagl_row['native_preparation_median_ms']))} [{fmt(number(msagl_row['native_preparation_p25_ms']))}–{fmt(number(msagl_row['native_preparation_p75_ms']))}]",
            ]
        )
    tables["T3"] = (
        output / "tables" / "T3-msagljs-architectural-baseline.tex",
        [source / "phylolens-vs-msagljs-descriptive-comparison.csv"],
        table_tex(
            [
                "Topology",
                "Leaves",
                "PhyloLens median [P25–P75] ms",
                "MSAGLJS median [P25–P75] ms",
            ],
            t3_rows,
            note="Descriptive matching-condition comparison only: current public MSAGLJS native MDS pipeline; not a reproduction of the manuscript IPSep-CoLa configuration.",
        ),
        ["Native preparation-to-browsable-state descriptive comparison."],
        ["Current public MSAGLJS native MDS pipeline; not IPSep-CoLa."],
    )

    a_rows = [
        [
            row["topology"],
            row["requested_leaves"],
            f"{row['success_count']}/{row['measured_count']}",
            f"{fmt(ms_to_seconds(row['preparation_ms_median']))} [{fmt(ms_to_seconds(row['preparation_ms_p25']))}–{fmt(ms_to_seconds(row['preparation_ms_p75']))}; {fmt(ms_to_seconds(row['preparation_ms_iqr']))}]",
            f"{fmt(bytes_to_gib(row['peak_rss_bytes_median']))} [{fmt(bytes_to_gib(row['peak_rss_bytes_p25']))}–{fmt(bytes_to_gib(row['peak_rss_bytes_p75']))}; {fmt(bytes_to_gib(row['peak_rss_bytes_iqr']))}]",
        ]
        for row in sorted(
            rq1, key=lambda item: (item["topology"], int(item["requested_leaves"]))
        )
    ]
    tables["A"] = (
        output / "tables" / "A-rq1-full-condition-summary.tex",
        [source / "rq1-condition-metrics.csv"],
        table_tex(
            [
                "Topology",
                "Leaves",
                "n",
                "Preparation median [P25–P75; IQR] s",
                "Peak RSS median [P25–P75; IQR] GiB",
            ],
            a_rows,
            note="The caterpillar 50,000-leaf condition has n=4 because one retained infrastructure-startup failure was not retried.",
        ),
        [
            "Full RQ1 condition summaries; milliseconds converted to seconds and bytes to GiB."
        ],
        [],
    )

    b_rows = []
    for row in sorted(rq2_latency, key=lambda item: int(item["primitive_count"])):
        memory, frames = (
            rq2_memory[row["condition_id"]],
            rq2_frames[row["condition_id"]],
        )
        b_rows.append(
            [
                row["family"],
                row["primitive_count"],
                f"{fmt(number(row['client_first_visualization_ms_median']))} [{fmt(number(row['client_first_visualization_ms_p25']))}–{fmt(number(row['client_first_visualization_ms_p75']))}]",
                f"{fmt(number(memory['js_heap_delta_bytes_median']) / (1024 * 1024))}",
                f"{fmt(number(frames['median_ms_median']))} / {fmt(number(frames['p95_ms_median']))} / {fmt(number(frames['above_50_ms_count_median']))}",
            ]
        )
    tables["B"] = (
        output / "tables" / "B-rq2-client-diagnostics.tex",
        [
            source / "rq2-first-visualization-summary.csv",
            source / "rq2-memory-summary.csv",
            source / "rq2-frame-summary.csv",
        ],
        table_tex(
            [
                "Fixture family",
                "Primitives",
                "First visualization median [P25–P75] ms",
                "Heap Δ median (MiB)",
                "Frame median / P95 / >50 ms",
            ],
            b_rows,
        ),
        ["Isolated client latency, heap-used delta, and frame diagnostics."],
        ["Isolated client microbenchmark after frozen replay fixture delivery."],
    )

    c_rows = [
        [
            f"L{row['lod_level']} (τ={row['threshold']})",
            row["materialized_visual_nodes"],
            row["materialized_edges"],
            row["represented_source_nodes"],
            f"{float(row['node_reduction_factor']):.3f}×",
            f"{float(row['primitive_reduction_ratio']) * 100:.2f}%",
            row["canonical_serialized_representation_bytes"],
            semantic_pass,
        ]
        for row in rq3
    ]
    tables["C"] = (
        output / "tables" / "C-rq3-fidelity-invariant-ledger.tex",
        [source / "rq3-lod-reduction.csv", source / "rq3-semantic-fidelity.json"],
        table_tex(
            [
                "Level",
                "Visual V",
                "Visual E",
                "Represented source nodes",
                "Node reduction",
                "Primitive reduction",
                "Canonical bytes",
                "Invariant ledger",
            ],
            c_rows,
        ),
        ["Full persisted LoD fidelity/invariant ledger."],
        [],
    )

    frame_by: dict[str, dict[str, dict[str, str]]] = {}
    for row in rq4_frames:
        frame_by.setdefault(row["scenario"], {})[row["sample"]] = row
    d_rows = []
    for scenario in rq4_order:
        row = rq4_by[scenario]
        frames = frame_by[scenario]
        d_rows.append(
            [
                scenario,
                f"{fmt(number(row['event_to_request_ms_median']))} / {fmt(number(row['browser_http_ms_median']))} / {fmt(number(row['response_to_snapshot_ms_median']))} / {fmt(number(row['event_to_snapshot_ms_median']))} / {fmt(number(row['snapshot_to_settle_ms_median']))}",
                f"{fmt(number(frames['baseline_frames']['median']))} / {fmt(number(frames['operation_frames']['median']))}",
                f"{row['pre_materialized_nodes']}/{row['pre_materialized_edges']} → {row['post_materialized_nodes']}/{row['post_materialized_edges']}",
                f"{row['truncated_response_count']}/{row['success_count']}",
            ]
        )
    tables["D"] = (
        output / "tables" / "D-rq4-complete-phase-frame-cardinality.tex",
        [
            source / "rq4-condition-metrics.csv",
            source / "rq4-frame-summary.csv",
            source / "rq4-state-cardinality.csv",
        ],
        table_tex(
            [
                "Scenario",
                "Phase medians: event→request / HTTP / response→snapshot / event→snapshot / snapshot→settle (ms)",
                "Baseline / operation frame medians (ms)",
                "Materialized V/E",
                "Truncated",
            ],
            d_rows,
            note="Blank request/HTTP phase values are represented as N/A for collapses, which issue no viewport request.",
        ),
        [
            "Complete RQ4 phase, frame, truncation, and materialized-cardinality summaries."
        ],
        [],
    )

    e_rows = [
        [
            row["topology"],
            row["requested_leaves"],
            f"{row['measured_successes']}/{row['observed_measured_count']}",
            f"{fmt(number(row['total_ms_median']))} [{fmt(number(row['total_ms_p25']))}–{fmt(number(row['total_ms_p75']))}]",
            f"{fmt(number(row['parse_ms_median']))}",
            f"{fmt(number(row['geometry_ms_median']))}",
            f"{fmt(number(row['layout_ms_median']))}",
            f"{fmt(number(row['routing_ms_median']))}",
            f"{fmt(number(row['tiling_ms_median']))}",
            f"{fmt(number(row['actual_tile_levels_median']))}",
        ]
        for row in sorted(
            msagl, key=lambda item: (item["topology"], int(item["requested_leaves"]))
        )
    ]
    tables["E"] = (
        output / "tables" / "E-msagljs-per-stage-timing.tex",
        [source / "msagljs-condition-metrics.csv"],
        table_tex(
            [
                "Topology",
                "Leaves",
                "n",
                "Total median [P25–P75] ms",
                "Parse",
                "Geometry",
                "Layout",
                "Routing",
                "Tiling",
                "Tile levels",
            ],
            e_rows,
            note="Current-source native MDS + Sleeve + TileMap path; timing stages are medians in milliseconds.",
        ),
        ["Full MSAGLJS per-stage timing summaries."],
        ["Current-source native MDS path; not manuscript IPSep-CoLa reproduction."],
    )

    for _, (path, _, tex, _, _) in tables.items():
        write_text(path, tex)
    return tables


def source_records(root: Path, files: list[Path]) -> list[dict[str, str]]:
    return [
        {"path": str(path.relative_to(root)), "sha256": sha256(path)} for path in files
    ]


def sidecar(
    root: Path,
    output: Path,
    *,
    artifact_id: str,
    artifacts: list[Path],
    source_files: list[Path],
    runs: list[str],
    metric_definitions: list[str],
    transformations: list[str],
    units: list[str],
    caveats: list[str],
    status: str,
) -> Path:
    path = output / "provenance" / f"{artifact_id}.json"
    payload = {
        "artifact_id": artifact_id,
        "status": status,
        "artifact_filenames": [str(item.relative_to(output)) for item in artifacts],
        "artifact_sha256": {
            str(item.relative_to(output)): sha256(item) for item in artifacts
        },
        "authoritative_source_runs": runs,
        "source_consolidated_files": source_records(root, source_files),
        "generation_script": "eval/src/phylo_lens_eval/publication_artifacts.py",
        "generation_commit": subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=root,
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip(),
        "frozen_consolidation_commit": CONSOLIDATION_COMMIT,
        "product_commit": PRODUCT_COMMIT,
        "metric_definitions": metric_definitions,
        "transformations": transformations,
        "units": units,
        "caveats": caveats,
    }
    write_json(path, payload)
    return path


def figure_sources(source: Path) -> dict[str, list[Path]]:
    return {
        "F1": [source / "rq1-condition-metrics.csv"],
        "F2": [source / "rq2-first-visualization-summary.csv"],
        "F3": [source / "rq3-lod-reduction.csv"],
        "F4": [source / "rq4-condition-metrics.csv"],
        "F5": [
            source / "external-comparison-first-meaningful-visual.csv",
            source / "external-comparison-topology-identity-status.csv",
            source / "external-comparison-provenance.json",
        ],
    }


def generate(root: Path, output: Path, *, replace: bool = False) -> list[Path]:
    source = root / SOURCE_DIRECTORY
    if not source.is_dir():
        raise FileNotFoundError(f"Consolidated evidence is missing: {source}")
    if output.exists():
        if not replace:
            raise FileExistsError(f"Refusing to replace publication output: {output}")
        shutil.rmtree(output)
    for directory in (output / "figures", output / "tables", output / "provenance"):
        directory.mkdir(parents=True, exist_ok=True)
    master = read_json(source / "master-evidence-index.json")
    studies = {row["study"]: row for row in master["studies"]}
    if any(
        studies[name]["authoritative_status"] != "authoritative"
        for name in (
            "RQ1",
            "RQ2",
            "RQ3",
            "RQ4",
            "MSAGLJS architectural baseline",
            "External comparison",
        )
    ):
        raise ValueError(
            "Only authoritative studies may contribute publication evidence"
        )

    figures = {
        "F1": (
            "F1-rq1-preparation-scalability",
            figure_f1(read_csv(source / "rq1-condition-metrics.csv")),
            ["thesis-final-rq1-v020-002"],
            [
                "Preparation median with P25–P75 interval",
                "Peak recursive process-tree RSS median with P25–P75 interval",
            ],
            [
                "ms converted to seconds",
                "bytes converted to GiB",
                "logarithmic x and y axes",
            ],
            ["seconds", "GiB"],
            [
                "Caterpillar 50k includes four successful measured observations; one retained infrastructure-startup failure was not retried."
            ],
        ),
        "F2": (
            "F2-rq2-client-visualization-scalability",
            figure_f2(read_csv(source / "rq2-first-visualization-summary.csv")),
            ["thesis-final-rq2-v020-001"],
            [
                "Isolated client first-visualization latency median with P25–P75 interval"
            ],
            ["logarithmic primitive-count x axis"],
            ["milliseconds"],
            [
                "Isolated client microbenchmark after frozen replay fixture delivery; not server-backed viewport latency, total startup, or full browser memory scalability."
            ],
        ),
        "F3": (
            "F3-rq3-lod-effectiveness",
            figure_f3(read_csv(source / "rq3-lod-reduction.csv")),
            ["thesis-final-rq3-v020-002"],
            [
                "Materialized visual-node ratio",
                "Primitive reduction relative to full detail",
            ],
            ["ratios converted to percentages", "categorical persisted levels only"],
            ["percent"],
            [
                "All persisted levels represent 13,075 source nodes; materialized visual-node counts are distinct from represented source-node counts."
            ],
        ),
        "F4": (
            "F4-rq4-interaction-responsiveness",
            figure_f4(read_csv(source / "rq4-condition-metrics.csv")),
            ["thesis-final-rq4-v020-003"],
            ["Browser-observed settle latency median with P25–P75 interval"],
            ["none"],
            ["milliseconds"],
            [
                "Settle latency is not physical display latency or pixel-complete latency."
            ],
        ),
        "F5": (
            "F5-external-native-path-comparison",
            figure_f5(
                read_csv(source / "external-comparison-first-meaningful-visual.csv")
            ),
            [
                "thesis-final-fullmst-combined-v020-004",
                "thesis-final-fullmst-001",
                "thesis-final-fullmst-phylolens-v020-004",
            ],
            [
                "Native-path end-to-end first meaningful visual time median with P25–P75 interval"
            ],
            ["ms converted to seconds", "logarithmic x and y axes"],
            ["seconds"],
            [
                "Native-path cross-system comparison across different architectures; not equivalent layout throughput, the same-algorithm benchmark, or a direct algorithmic speed comparison.",
                "PhyloLens topology verified but identity unverified by public API; Phylotree topology verified with root-label identity failure; Taxonium execution/scalability eligible but topology/identity unverified by public component API.",
            ],
        ),
    }
    generated: list[Path] = []
    source_map = figure_sources(source)
    figure_sidecars: dict[str, Path] = {}
    for artifact_id, (
        stem,
        svg,
        runs,
        metrics,
        transformations,
        units,
        caveats,
    ) in figures.items():
        artifacts = export_figure(svg, output, stem)
        generated.extend(artifacts)
        figure_sidecars[artifact_id] = sidecar(
            root,
            output,
            artifact_id=artifact_id,
            artifacts=artifacts,
            source_files=source_map[artifact_id],
            runs=runs,
            metric_definitions=metrics,
            transformations=transformations,
            units=units,
            caveats=caveats,
            status="MAIN_TEXT",
        )
        generated.append(figure_sidecars[artifact_id])

    tables = render_tables(source, output)
    table_sidecars: dict[str, Path] = {}
    table_runs = {
        "T1": ["thesis-final-rq3-v020-002"],
        "T2": ["thesis-final-rq4-v020-003"],
        "T3": ["thesis-msagljs-mds-v001-001", "thesis-final-rq1-v020-002"],
        "A": ["thesis-final-rq1-v020-002"],
        "B": ["thesis-final-rq2-v020-001"],
        "C": ["thesis-final-rq3-v020-002"],
        "D": ["thesis-final-rq4-v020-003"],
        "E": ["thesis-msagljs-mds-v001-001"],
    }
    for artifact_id, (path, sources, _, metrics, caveats) in tables.items():
        status = "MAIN_TEXT" if artifact_id.startswith("T") else "APPENDIX"
        table_sidecars[artifact_id] = sidecar(
            root,
            output,
            artifact_id=artifact_id,
            artifacts=[path],
            source_files=sources,
            runs=table_runs[artifact_id],
            metric_definitions=metrics,
            transformations=[
                "Deterministic numeric formatting only; all values parsed from consolidated CSV/JSON."
            ],
            units=["As stated in table headers"],
            caveats=caveats,
            status=status,
        )
        generated.extend([path, table_sidecars[artifact_id]])

    manifest = {
        "schema_version": "1",
        "generation_script": "eval/src/phylo_lens_eval/publication_artifacts.py",
        "generation_commit": subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=root,
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip(),
        "frozen_consolidation_commit": CONSOLIDATION_COMMIT,
        "artifacts": [
            *[
                {
                    "id": item,
                    "status": "MAIN_TEXT",
                    "rq_or_comparison": {
                        "F1": "RQ1",
                        "F2": "RQ2",
                        "F3": "RQ3",
                        "F4": "RQ4",
                        "F5": "External comparison",
                    }[item],
                    "files": [str(path.relative_to(output)) for path in export_paths],
                    "provenance_sidecar": str(
                        figure_sidecars[item].relative_to(output)
                    ),
                }
                for item, (stem, *_rest) in figures.items()
                for export_paths in [
                    [
                        output / "figures" / f"{stem}.svg",
                        output / "figures" / f"{stem}.pdf",
                        output / "figures" / f"{stem}.png",
                    ]
                ]
            ],
            *[
                {
                    "id": item,
                    "status": "MAIN_TEXT" if item.startswith("T") else "APPENDIX",
                    "rq_or_comparison": {
                        "T1": "RQ3",
                        "T2": "RQ4",
                        "T3": "MSAGLJS baseline",
                        "A": "RQ1",
                        "B": "RQ2",
                        "C": "RQ3",
                        "D": "RQ4",
                        "E": "MSAGLJS baseline",
                    }[item],
                    "files": [str(data[0].relative_to(output))],
                    "provenance_sidecar": str(table_sidecars[item].relative_to(output)),
                }
                for item, data in tables.items()
            ],
        ],
    }
    manifest_path = output / "publication-artifacts.json"
    write_json(manifest_path, manifest)
    generated.append(manifest_path)
    readme = "# Final publication artifacts\n\nGenerated only from the reconciled consolidated evidence. Reproduce with:\n\n```sh\nPYTHONPATH=eval/src .venv/bin/python -m phylo_lens_eval.publication_artifacts --replace\n```\n\nThe provenance sidecar beside every artifact records source checksums, transformations, caveats, and generated-file checksums. No raw evidence is modified by this renderer.\n"
    readme_path = output / "README.md"
    write_text(readme_path, readme)
    generated.append(readme_path)
    return generated


def validate(root: Path, output: Path) -> None:
    source = root / SOURCE_DIRECTORY
    master = read_json(source / "master-evidence-index.json")
    studies = {row["study"]: row for row in master["studies"]}
    assert all(
        studies[name]["authoritative_status"] == "authoritative"
        for name in (
            "RQ1",
            "RQ2",
            "RQ3",
            "RQ4",
            "MSAGLJS architectural baseline",
            "External comparison",
        )
    )
    rq1 = read_csv(source / "rq1-condition-metrics.csv")
    assert len(rq1) == 15
    caterpillar_50k = next(
        row for row in rq1 if row["condition_id"] == "caterpillar-50000"
    )
    assert (
        caterpillar_50k["success_count"] == "4"
        and caterpillar_50k["measured_count"] == "5"
    )
    rq2 = read_csv(source / "rq2-first-visualization-summary.csv")
    assert {row["family"] for row in rq2} == {"detail", "triangle_control"}
    rq3 = read_csv(source / "rq3-lod-reduction.csv")
    assert len(rq3) == 3 and {row["represented_source_nodes"] for row in rq3} == {
        "13075"
    }
    rq4 = read_csv(source / "rq4-condition-metrics.csv")
    expected = {
        "navigation",
        "expand-low",
        "collapse-low",
        "expand-representative",
        "collapse-representative",
        "expand-high",
        "collapse-high",
    }
    assert {row["scenario"] for row in rq4} == expected
    for row in rq4:
        if row["scenario"].startswith("collapse"):
            assert row["measured_request_count"] == "0"
            assert row["browser_http_ms_median"] == ""
    external = read_csv(source / "external-comparison-first-meaningful-visual.csv")
    assert len(external) == 30
    assert {row["source_run_id"] for row in external} == {
        "thesis-final-fullmst-001",
        "thesis-final-fullmst-phylolens-v020-004",
    }
    manifest = read_json(output / "publication-artifacts.json")
    for entry in manifest["artifacts"]:
        sidecar = read_json(output / entry["provenance_sidecar"])
        for name, expected_sha in sidecar["artifact_sha256"].items():
            path = output / name
            assert sha256(path) == expected_sha
            if path.suffix == ".svg":
                element_tree.parse(path)
            elif path.suffix == ".pdf":
                assert path.read_bytes().startswith(b"%PDF")
            elif path.suffix == ".png":
                assert path.read_bytes().startswith(b"\x89PNG\r\n\x1a\n")
            elif path.suffix == ".tex":
                assert "\\begin{tabular}" in path.read_text(encoding="utf-8")
    with tempfile.TemporaryDirectory() as temporary:
        temp = Path(temporary)
        for entry in manifest["artifacts"]:
            for filename in entry["files"]:
                table = output / filename
                if table.suffix != ".tex":
                    continue
                document = temp / f"{table.stem}.tex"
                write_text(
                    document,
                    "\\documentclass{article}\n\\begin{document}\n\\input{"
                    + str(table)
                    + "}\n\\end{document}\n",
                )
                subprocess.run(
                    [
                        "pdflatex",
                        "-interaction=nonstopmode",
                        "-halt-on-error",
                        "-output-directory",
                        str(temp),
                        str(document),
                    ],
                    check=True,
                    capture_output=True,
                    text=True,
                )


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Render final publication artifacts from reconciliation."
    )
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument(
        "--replace", action="store_true", help="replace only publication-derived output"
    )
    parser.add_argument("--validate-only", action="store_true")
    args = parser.parse_args()
    root = repository_root()
    output = args.output_dir or root / SOURCE_DIRECTORY / "publication"
    if args.validate_only:
        validate(root, output.resolve())
        print("publication validation: PASS")
        return
    for path in generate(root, output.resolve(), replace=args.replace):
        print(path)
    validate(root, output.resolve())
    print("publication validation: PASS")


if __name__ == "__main__":
    main()
