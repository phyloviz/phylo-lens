from phylo_lens_server.benchmarking.lod import (
    benchmark_dataset,
    build_default_query_specs,
    evaluate_visible_layout,
    generate_balanced_binary_tree,
    generate_skewed_tree,
)
from phylo_lens_server.core.models import CanonicalEdge, CanonicalNode


def test_generate_balanced_binary_tree_counts_match_requested_size() -> None:
    """Confirm the balanced synthetic generator emits a valid tree shape."""
    dataset = generate_balanced_binary_tree(7)

    assert dataset.dataset_id == "balanced-7"
    assert len(dataset.nodes) == 7
    assert len(dataset.edges) == 6
    assert dataset.nodes[0].id == "root"
    assert dataset.edges[0].source == "root"


def test_generate_skewed_tree_counts_match_requested_size() -> None:
    """Confirm the skewed synthetic generator emits a degenerate tree."""
    dataset = generate_skewed_tree(4)

    assert dataset.dataset_id == "skewed-4"
    assert len(dataset.nodes) == 4
    assert len(dataset.edges) == 3
    assert [edge.source for edge in dataset.edges] == ["root", "n_000001", "n_000002"]


def test_default_query_specs_include_focus_case() -> None:
    """Confirm the benchmark query suite exercises overview and focused detail."""
    dataset = generate_balanced_binary_tree(9)
    specs = build_default_query_specs(dataset)

    assert [spec.name for spec in specs] == ["overview", "mid", "detail_focus"]
    assert specs[-1].focus_node_id == dataset.nodes[-1].id


def test_benchmark_dataset_returns_one_row_per_default_query() -> None:
    """Confirm the benchmark harness returns structured summary rows."""
    dataset = generate_balanced_binary_tree(15)
    rows = benchmark_dataset(dataset, shape="balanced", repeats=1)

    assert len(rows) == 3
    assert all(row.node_count == 15 for row in rows)
    assert all(row.shape == "balanced" for row in rows)
    assert all(row.hierarchy_median_ms >= 0 for row in rows)
    assert all(row.selector_median_ms >= 0 for row in rows)
    assert all(row.crossing_count_median >= 0 for row in rows)
    assert all(row.bounds_aspect_ratio_median >= 1 for row in rows)


def test_evaluate_visible_layout_counts_crossings_and_near_overlaps() -> None:
    """Confirm quality metrics catch crossings and close node pairs."""
    nodes = [
        CanonicalNode(id="a", x=0, y=0),
        CanonicalNode(id="b", x=10, y=10),
        CanonicalNode(id="c", x=0, y=10),
        CanonicalNode(id="d", x=10, y=0),
        CanonicalNode(id="e", x=1, y=1),
    ]
    edges = [
        CanonicalEdge(id="e_a_b", source="a", target="b"),
        CanonicalEdge(id="e_c_d", source="c", target="d"),
    ]

    metrics = evaluate_visible_layout(nodes, edges, near_overlap_distance=2)

    assert metrics.crossing_count == 1
    assert metrics.near_overlap_count == 1
    assert metrics.edge_length_median > 0
    assert metrics.edge_length_p95 >= metrics.edge_length_median
    assert metrics.bounds_aspect_ratio == 1
