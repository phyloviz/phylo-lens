from __future__ import annotations

import gc
import json
import statistics
import time
import tracemalloc
from dataclasses import asdict, dataclass

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
    hierarchy_timings_ms: list[float] = []
    hierarchy_peak_mb: list[float] = []
    hierarchy: ThresholdHierarchyIndex | None = None

    for _ in range(repeats):
        gc.collect()
        tracemalloc.start()
        start = time.perf_counter()
        hierarchy = build_threshold_hierarchy(dataset)
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
            )
        )

    return rows


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
        ]
        for row in rows
    ]
    widths = [
        max(len(headers[index]), *(len(row[index]) for row in values))
        for index in range(len(headers))
    ]

    def _render_line(parts: list[str]) -> str:
        return " | ".join(
            part.ljust(widths[index]) for index, part in enumerate(parts)
        )

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
