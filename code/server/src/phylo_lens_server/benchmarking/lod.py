from __future__ import annotations

import gc
import json
import math
import statistics
import time
import tracemalloc
from dataclasses import asdict, dataclass

from phylo_lens_server.clustering.force_directed import apply_force_directed_layout_if_needed
from phylo_lens_server.clustering.selector import select_visible_slice
from phylo_lens_server.clustering.threshold_hierarchy import build_threshold_hierarchy
from phylo_lens_server.core.models import (
    CanonicalDataset,
    CanonicalEdge,
    CanonicalNode,
    DatasetSource,
    SourceFormat,
    ThresholdHierarchyIndex,
    Viewport,
    VisibleSliceQuery,
)

DEFAULT_VIEWPORT = Viewport(x=0, y=0, width=1000, height=600)
DEFAULT_REPEATS = 7


@dataclass(frozen=True)
class BenchmarkQuerySpec:
    name: str
    zoom: float
    max_nodes: int
    focus_node_id: str | None = None


@dataclass(frozen=True)
class BenchmarkRow:
    shape: str
    node_count: int
    repeats: int
    hierarchy_median_ms: float
    hierarchy_peak_median_mb: float
    query_name: str
    query_zoom: float
    query_max_nodes: int
    selector_median_ms: float
    returned_node_median: float
    returned_edge_median: float
    collapsed_cluster_median: float
    crossing_count_median: float
    near_overlap_count_median: float
    edge_length_median: float
    edge_length_p95_median: float
    bounds_aspect_ratio_median: float


def generate_balanced_binary_tree(
    node_count: int,
    dataset_id: str | None = None,
) -> CanonicalDataset:
    """Build a deterministic near-complete binary tree dataset."""
    if node_count < 1:
        raise ValueError("node_count must be >= 1")

    dataset_id = dataset_id or f"balanced-{node_count}"
    nodes = [CanonicalNode(id=_node_id(index)) for index in range(node_count)]
    edges: list[CanonicalEdge] = []

    for child_index in range(1, node_count):
        parent_index = (child_index - 1) // 2
        edges.append(
            CanonicalEdge(
                id=f"e_{_node_id(parent_index)}_{_node_id(child_index)}_1",
                source=_node_id(parent_index),
                target=_node_id(child_index),
                distance=_synthetic_distance(child_index),
            )
        )

    return CanonicalDataset(
        dataset_id=dataset_id,
        nodes=nodes,
        edges=edges,
        metadata_schema=[],
        metadata_by_node_id={},
        source=DatasetSource(
            format=SourceFormat.EDGELIST,
            generated_at="1970-01-01T00:00:00Z",
            provenance="synthetic-balanced-binary-tree",
        ),
    )


def generate_skewed_tree(
    node_count: int,
    dataset_id: str | None = None,
) -> CanonicalDataset:
    """Build a deterministic degenerate tree with one child per internal node."""
    if node_count < 1:
        raise ValueError("node_count must be >= 1")

    dataset_id = dataset_id or f"skewed-{node_count}"
    nodes = [CanonicalNode(id=_node_id(index)) for index in range(node_count)]
    edges = [
        CanonicalEdge(
            id=f"e_{_node_id(index)}_{_node_id(index + 1)}_1",
            source=_node_id(index),
            target=_node_id(index + 1),
            distance=_synthetic_distance(index + 1),
        )
        for index in range(node_count - 1)
    ]

    return CanonicalDataset(
        dataset_id=dataset_id,
        nodes=nodes,
        edges=edges,
        metadata_schema=[],
        metadata_by_node_id={},
        source=DatasetSource(
            format=SourceFormat.EDGELIST,
            generated_at="1970-01-01T00:00:00Z",
            provenance="synthetic-skewed-tree",
        ),
    )


def build_default_query_specs(dataset: CanonicalDataset) -> list[BenchmarkQuerySpec]:
    """Create a small, reproducible query suite for LoD evaluation."""
    node_count = len(dataset.nodes)
    deepest_focus = dataset.nodes[-1].id
    return [
        BenchmarkQuerySpec(
            name="overview",
            zoom=0.4,
            max_nodes=min(max(32, node_count), 256),
        ),
        BenchmarkQuerySpec(
            name="mid",
            zoom=1.8,
            max_nodes=min(max(128, node_count // 8), 2_000),
        ),
        BenchmarkQuerySpec(
            name="detail_focus",
            zoom=4.0,
            max_nodes=min(max(512, node_count // 4), 5_000),
            focus_node_id=deepest_focus,
        ),
    ]


def benchmark_dataset(
    dataset: CanonicalDataset,
    shape: str,
    repeats: int = DEFAULT_REPEATS,
    viewport: Viewport = DEFAULT_VIEWPORT,
) -> list[BenchmarkRow]:
    """Benchmark hierarchy build and the default visible-slice query suite."""
    dataset = apply_force_directed_layout_if_needed(dataset)
    hierarchy_timings_ms: list[float] = []
    hierarchy_peak_mb: list[float] = []
    hierarchy: ThresholdHierarchyIndex | None = None

    for _ in range(repeats):
        gc.collect()
        tracemalloc.start()
        start = time.perf_counter()
        hierarchy, _ = build_threshold_hierarchy(dataset)
        hierarchy_timings_ms.append((time.perf_counter() - start) * 1000)
        _, peak_bytes = tracemalloc.get_traced_memory()
        tracemalloc.stop()
        hierarchy_peak_mb.append(peak_bytes / (1024 * 1024))

    if hierarchy is None:
        raise RuntimeError("Hierarchy benchmark did not produce a hierarchy.")

    rows: list[BenchmarkRow] = []
    for query_spec in build_default_query_specs(dataset):
        selector_timings_ms: list[float] = []
        returned_node_counts: list[int] = []
        returned_edge_counts: list[int] = []
        collapsed_cluster_counts: list[int] = []
        crossing_counts: list[int] = []
        near_overlap_counts: list[int] = []
        edge_length_medians: list[float] = []
        edge_length_p95_values: list[float] = []
        bounds_aspect_ratios: list[float] = []

        for _ in range(repeats):
            gc.collect()
            start = time.perf_counter()
            response = select_visible_slice(
                dataset,
                hierarchy,
                VisibleSliceQuery(
                    dataset_id=dataset.dataset_id,
                    viewport=viewport,
                    zoom=query_spec.zoom,
                    max_nodes=query_spec.max_nodes,
                    focus_node_id=query_spec.focus_node_id,
                ),
            )
            selector_timings_ms.append((time.perf_counter() - start) * 1000)
            returned_node_counts.append(len(response.nodes))
            returned_edge_counts.append(len(response.edges))
            collapsed_cluster_counts.append(len(response.collapsed_clusters))
            metrics = evaluate_visible_layout(response.nodes, response.edges)
            crossing_counts.append(metrics.crossing_count)
            near_overlap_counts.append(metrics.near_overlap_count)
            edge_length_medians.append(metrics.edge_length_median)
            edge_length_p95_values.append(metrics.edge_length_p95)
            bounds_aspect_ratios.append(metrics.bounds_aspect_ratio)

        rows.append(
            BenchmarkRow(
                shape=shape,
                node_count=len(dataset.nodes),
                repeats=repeats,
                hierarchy_median_ms=_median(hierarchy_timings_ms),
                hierarchy_peak_median_mb=_median(hierarchy_peak_mb),
                query_name=query_spec.name,
                query_zoom=query_spec.zoom,
                query_max_nodes=query_spec.max_nodes,
                selector_median_ms=_median(selector_timings_ms),
                returned_node_median=_median(returned_node_counts),
                returned_edge_median=_median(returned_edge_counts),
                collapsed_cluster_median=_median(collapsed_cluster_counts),
                crossing_count_median=_median(crossing_counts),
                near_overlap_count_median=_median(near_overlap_counts),
                edge_length_median=_median(edge_length_medians),
                edge_length_p95_median=_median(edge_length_p95_values),
                bounds_aspect_ratio_median=_median(bounds_aspect_ratios),
            )
        )

    return rows


@dataclass(frozen=True)
class LayoutQualityMetrics:
    crossing_count: int
    near_overlap_count: int
    edge_length_median: float
    edge_length_p95: float
    bounds_aspect_ratio: float


def evaluate_visible_layout(
    nodes: list[CanonicalNode],
    edges: list[CanonicalEdge],
    *,
    near_overlap_distance: float = 20.0,
) -> LayoutQualityMetrics:
    """Compute deterministic quality metrics for one visible positioned slice."""
    node_positions = {
        node.id: (node.x, node.y)
        for node in nodes
        if node.x is not None and node.y is not None
    }
    edge_segments = [
        (
            edge.source,
            edge.target,
            node_positions[edge.source],
            node_positions[edge.target],
        )
        for edge in edges
        if edge.source in node_positions and edge.target in node_positions
    ]
    edge_lengths = [
        _distance(source_position, target_position)
        for _, _, source_position, target_position in edge_segments
    ]

    return LayoutQualityMetrics(
        crossing_count=_count_edge_crossings(edge_segments),
        near_overlap_count=_count_near_overlaps(
            list(node_positions.values()),
            near_overlap_distance,
        ),
        edge_length_median=_median(edge_lengths) if edge_lengths else 0.0,
        edge_length_p95=_percentile(edge_lengths, 0.95) if edge_lengths else 0.0,
        bounds_aspect_ratio=_bounds_aspect_ratio(list(node_positions.values())),
    )


def format_rows_as_table(rows: list[BenchmarkRow]) -> str:
    """Render benchmark rows as a readable plain-text table."""
    headers = [
        "shape",
        "nodes",
        "query",
        "zoom",
        "max_nodes",
        "hier_ms",
        "hier_mb",
        "slice_ms",
        "ret_nodes",
        "ret_edges",
        "collapsed",
        "cross",
        "near",
        "edge_med",
        "edge_p95",
        "aspect",
    ]
    values = [
        [
            row.shape,
            str(row.node_count),
            row.query_name,
            f"{row.query_zoom:.2f}",
            str(row.query_max_nodes),
            f"{row.hierarchy_median_ms:.3f}",
            f"{row.hierarchy_peak_median_mb:.3f}",
            f"{row.selector_median_ms:.3f}",
            f"{row.returned_node_median:.1f}",
            f"{row.returned_edge_median:.1f}",
            f"{row.collapsed_cluster_median:.1f}",
            f"{row.crossing_count_median:.1f}",
            f"{row.near_overlap_count_median:.1f}",
            f"{row.edge_length_median:.2f}",
            f"{row.edge_length_p95_median:.2f}",
            f"{row.bounds_aspect_ratio_median:.2f}",
        ]
        for row in rows
    ]
    widths = [
        max(len(headers[index]), *(len(row[index]) for row in values))
        for index in range(len(headers))
    ]

    def _render_line(parts: list[str]) -> str:
        return " | ".join(part.ljust(widths[index]) for index, part in enumerate(parts))

    divider = "-+-".join("-" * width for width in widths)
    lines = [_render_line(headers), divider]
    lines.extend(_render_line(row) for row in values)
    return "\n".join(lines)


def format_rows_as_json(rows: list[BenchmarkRow]) -> str:
    """Render benchmark rows as deterministic JSON."""
    return json.dumps([asdict(row) for row in rows], indent=2)


def _node_id(index: int) -> str:
    if index == 0:
        return "root"
    return f"n_{index:06d}"


def _synthetic_distance(index: int) -> float:
    return float((index % 7) + 1)


def _median(values: list[int] | list[float]) -> float:
    return float(statistics.median(values))


Point = tuple[float, float]
EdgeSegment = tuple[str, str, Point, Point]


def _count_edge_crossings(edge_segments: list[EdgeSegment]) -> int:
    crossing_count = 0
    for left_index, left in enumerate(edge_segments):
        left_source, left_target, left_start, left_end = left
        for right_source, right_target, right_start, right_end in edge_segments[
            left_index + 1 :
        ]:
            if (
                left_source == right_source
                or left_source == right_target
                or left_target == right_source
                or left_target == right_target
            ):
                continue
            if _segments_cross(left_start, left_end, right_start, right_end):
                crossing_count += 1
    return crossing_count


def _segments_cross(
    left_start: Point,
    left_end: Point,
    right_start: Point,
    right_end: Point,
) -> bool:
    left_orientation_1 = _orientation(left_start, left_end, right_start)
    left_orientation_2 = _orientation(left_start, left_end, right_end)
    right_orientation_1 = _orientation(right_start, right_end, left_start)
    right_orientation_2 = _orientation(right_start, right_end, left_end)

    return (
        left_orientation_1 * left_orientation_2 < 0
        and right_orientation_1 * right_orientation_2 < 0
    )


def _orientation(origin: Point, target: Point, point: Point) -> float:
    return (target[0] - origin[0]) * (point[1] - origin[1]) - (
        target[1] - origin[1]
    ) * (point[0] - origin[0])


def _count_near_overlaps(
    positions: list[Point],
    distance_threshold: float,
) -> int:
    squared_threshold = distance_threshold * distance_threshold
    near_overlap_count = 0
    for left_index, left in enumerate(positions):
        for right in positions[left_index + 1 :]:
            if _squared_distance(left, right) <= squared_threshold:
                near_overlap_count += 1
    return near_overlap_count


def _distance(left: Point, right: Point) -> float:
    return math.sqrt(_squared_distance(left, right))


def _squared_distance(left: Point, right: Point) -> float:
    delta_x = left[0] - right[0]
    delta_y = left[1] - right[1]
    return delta_x * delta_x + delta_y * delta_y


def _percentile(values: list[float], percentile: float) -> float:
    if not values:
        return 0.0
    sorted_values = sorted(values)
    index = min(
        len(sorted_values) - 1,
        max(0, math.ceil(percentile * len(sorted_values)) - 1),
    )
    return float(sorted_values[index])


def _bounds_aspect_ratio(positions: list[Point]) -> float:
    if len(positions) <= 1:
        return 1.0

    min_x = min(position[0] for position in positions)
    max_x = max(position[0] for position in positions)
    min_y = min(position[1] for position in positions)
    max_y = max(position[1] for position in positions)
    width = max(max_x - min_x, 1e-9)
    height = max(max_y - min_y, 1e-9)
    return max(width / height, height / width)
