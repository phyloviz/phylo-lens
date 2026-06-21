from collections import Counter

from phylo_lens_server.clustering.selector import (
    select_visible_slice,
    topology_budget_limit,
)
from phylo_lens_server.clustering.selection_policy import target_level_for_query
from phylo_lens_server.clustering.threshold_hierarchy import build_threshold_hierarchy
from phylo_lens_server.core.models import Viewport, VisibleSliceQuery
from phylo_lens_server.data.normalizer import NormalizeRequest, normalize_dataset

FORMAT_EDGELIST = "edgelist"
DATASET_THRESHOLD = "threshold-tree"
WEIGHTED_CHAIN = "source,target,distance\na,b,1\nb,c,2\nc,d,4\n"


def _threshold_dataset_and_hierarchy():
    dataset = normalize_dataset(
        NormalizeRequest(
            format=FORMAT_EDGELIST,
            dataset_name=DATASET_THRESHOLD,
            content=WEIGHTED_CHAIN,
        )
    ).dataset
    positions = {
        "a": (0.0, 0.0),
        "b": (1.0, 1.0),
        "c": (2.0, 0.0),
        "d": (3.0, -1.0),
    }
    dataset = dataset.model_copy(
        update={
            "nodes": [
                node.model_copy(
                    update={"x": positions[node.id][0], "y": positions[node.id][1]}
                )
                for node in dataset.nodes
            ]
        }
    )
    hierarchy, _ = build_threshold_hierarchy(dataset)
    return dataset, hierarchy


def _viewport() -> Viewport:
    return Viewport(x=0, y=0, width=1000, height=600)


def _query(**updates) -> VisibleSliceQuery:
    return VisibleSliceQuery(
        dataset_id=DATASET_THRESHOLD,
        viewport=_viewport(),
        zoom=2.0,
        max_nodes=4,
    ).model_copy(update=updates)


def test_select_visible_slice_is_deterministic_for_threshold_hierarchies() -> None:
    dataset, hierarchy = _threshold_dataset_and_hierarchy()

    first = select_visible_slice(dataset, hierarchy, _query())
    second = select_visible_slice(dataset, hierarchy, _query())

    assert first.model_dump() == second.model_dump()
    assert first.view_meta.global_bounds is not None
    assert first.view_meta.global_bounds.min_x < first.view_meta.global_bounds.max_x
    assert first.view_meta.global_bounds.min_y < first.view_meta.global_bounds.max_y


def test_select_visible_slice_keeps_focused_node_when_bounded() -> None:
    dataset, hierarchy = _threshold_dataset_and_hierarchy()

    response = select_visible_slice(
        dataset,
        hierarchy,
        _query(zoom=3.0, max_nodes=3, focus_node_id="d"),
    )

    assert "d" in {node.id for node in response.nodes}
    assert len(response.nodes) <= 3


def test_select_visible_slice_respects_node_budget_without_focus() -> None:
    dataset, hierarchy = _threshold_dataset_and_hierarchy()

    response = select_visible_slice(
        dataset,
        hierarchy,
        _query(zoom=3.0, max_nodes=2),
    )

    assert len(response.nodes) <= 2


def test_select_visible_slice_only_returns_edges_between_visible_nodes() -> None:
    dataset, hierarchy = _threshold_dataset_and_hierarchy()

    response = select_visible_slice(dataset, hierarchy, _query(zoom=3.0))
    visible_node_ids = {node.id for node in response.nodes}

    assert all(
        edge.source in visible_node_ids and edge.target in visible_node_ids
        for edge in response.edges
    )


def test_select_visible_slice_expands_requested_cluster() -> None:
    dataset, hierarchy = _threshold_dataset_and_hierarchy()
    cluster_id = next(
        cluster.cluster_id
        for cluster in hierarchy.clusters.values()
        if cluster.child_cluster_ids
    )

    collapsed = select_visible_slice(dataset, hierarchy, _query(zoom=0.4))
    expanded = select_visible_slice(
        dataset,
        hierarchy,
        _query(zoom=0.4, expanded_cluster_ids=[cluster_id]),
    )

    assert len(expanded.nodes) >= len(collapsed.nodes)
    assert cluster_id not in {
        node.cluster_id
        for node in expanded.nodes
        if node.is_cluster_proxy is True
    }


def test_select_visible_slice_collapsed_cluster_wins_over_expanded_cluster() -> None:
    dataset, hierarchy = _threshold_dataset_and_hierarchy()
    cluster_id = next(
        cluster.cluster_id
        for cluster in hierarchy.clusters.values()
        if cluster.child_cluster_ids
    )

    response = select_visible_slice(
        dataset,
        hierarchy,
        _query(
            zoom=3.0,
            expanded_cluster_ids=[cluster_id],
            collapsed_cluster_ids=[cluster_id],
        ),
    )

    assert any(
        node.cluster_id == cluster_id and node.is_cluster_proxy is True
        for node in response.nodes
    )


def test_select_visible_slice_focus_cluster_is_reported_in_view_metadata() -> None:
    dataset, hierarchy = _threshold_dataset_and_hierarchy()
    cluster_id = next(iter(hierarchy.clusters))

    response = select_visible_slice(
        dataset,
        hierarchy,
        _query(focus_cluster_id=cluster_id),
    )

    assert response.view_meta.focus_cluster_id == cluster_id
    assert response.view_meta.focus_cluster_bounds is not None


def test_select_visible_slice_does_not_increase_tree_degree() -> None:
    dataset, hierarchy = _threshold_dataset_and_hierarchy()
    original_degree = Counter()
    for edge in dataset.edges:
        original_degree.update((edge.source, edge.target))

    response = select_visible_slice(dataset, hierarchy, _query(zoom=3.0))
    visible_degree = Counter()
    for edge in response.edges:
        visible_degree.update((edge.source, edge.target))

    assert max(visible_degree.values(), default=0) <= max(original_degree.values())


def test_topology_budget_allows_small_skeleton_overflow() -> None:
    assert topology_budget_limit(9000) == 10080


def test_automatic_initial_view_starts_at_level_one() -> None:
    dataset, hierarchy = _threshold_dataset_and_hierarchy()

    assert target_level_for_query(hierarchy, _query(zoom=0.5)) == 1
    assert target_level_for_query(hierarchy, _query(zoom=1.0)) == 1
    assert target_level_for_query(hierarchy, _query(zoom=1.0, lod_hint=0)) == 0
