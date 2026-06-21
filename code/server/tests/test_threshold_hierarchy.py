from phylo_lens_server.clustering.selector import select_visible_slice
from phylo_lens_server.clustering import force_directed
from phylo_lens_server.clustering.force_directed import (
    compute_force_directed_positions,
    apply_force_directed_layout_if_needed,
)
from phylo_lens_server.clustering.threshold_hierarchy import (
    ThresholdHierarchyBuildError,
    build_threshold_hierarchy,
)
from phylo_lens_server.core.models import VisibleSliceQuery, Viewport
from phylo_lens_server.data.normalizer import NormalizeRequest, normalize_dataset

FORMAT_EDGELIST = "edgelist"
DATASET_THRESHOLD = "threshold-tree"
WEIGHTED_CHAIN = "source,target,distance\na,b,1\nb,c,2\nc,d,4\n"
WEIGHTED_FOREST = "source,target,distance\na,b,1\nc,d,2\n"
WEIGHTED_DEEP_FOREST = "source,target,distance\na,b,1\nb,c,2\nd,e,1\ne,f,2\n"
WEIGHTED_MISSING_DISTANCE = "source,target\na,b\nb,c\n"


def _weighted_dataset():
    dataset = normalize_dataset(
        NormalizeRequest(
            format=FORMAT_EDGELIST,
            dataset_name=DATASET_THRESHOLD,
            content=WEIGHTED_CHAIN,
        )
    ).dataset
    return apply_force_directed_layout_if_needed(dataset)


def _prepared_threshold_hierarchy(dataset):
    dataset = apply_force_directed_layout_if_needed(dataset)
    hierarchy, _ = build_threshold_hierarchy(dataset)
    return dataset, hierarchy


def test_build_threshold_hierarchy_creates_nested_threshold_levels() -> None:
    dataset = _weighted_dataset()

    _, hierarchy = _prepared_threshold_hierarchy(dataset)

    assert hierarchy.kind == "threshold"
    assert len(hierarchy.top_cluster_ids) == 1
    root = hierarchy.clusters[hierarchy.top_cluster_ids[0]]
    assert root.member_node_ids == ["a", "b", "c", "d"]
    assert root.distance_threshold_level == 0
    assert root.distance_threshold == 4

    child_clusters = [
        hierarchy.clusters[cluster_id] for cluster_id in root.child_cluster_ids
    ]
    assert [cluster.member_node_ids for cluster in child_clusters] == [
        ["a", "b", "c"],
        ["d"],
    ]
    assert [cluster.distance_threshold_level for cluster in child_clusters] == [1, 1]
    assert root.centroid is not None
    assert root.bounds is not None
    assert root.bounds["min_x"] < root.bounds["max_x"]
    assert root.bounds["min_y"] < root.bounds["max_y"]
    assert hierarchy.global_bounds is not None
    assert hierarchy.global_bounds.min_x < hierarchy.global_bounds.max_x
    assert hierarchy.global_bounds.min_y < hierarchy.global_bounds.max_y
    assert hierarchy.max_distance_threshold_level == 3
    assert hierarchy.cluster_ids_by_level[0] == hierarchy.top_cluster_ids
    assert set(hierarchy.cluster_ids_by_level[1]) == {
        "threshold_cluster_1_a",
        "threshold_cluster_1_d",
    }
    assert 1 in hierarchy.spatial_index_by_level
    level_index = hierarchy.spatial_index_by_level[1]
    assert level_index.root_node_index is not None
    assert len(level_index.nodes) >= 1


def test_build_threshold_hierarchy_does_not_recompute_layout() -> None:
    dataset = _weighted_dataset()

    _, stats = build_threshold_hierarchy(dataset)

    assert stats.layout_ms == 0.0


def test_force_layout_is_undirected_and_does_not_use_threshold_distances(
    monkeypatch,
) -> None:
    dataset = normalize_dataset(
        NormalizeRequest(
            format=FORMAT_EDGELIST,
            dataset_name="topology-layout",
            content="source,target,distance\na,b,1\nb,c,2\n",
        )
    ).dataset
    captured: dict[str, object] = {}

    class FakeGraph:
        def __init__(self, *, n, edges, directed):
            captured["graph"] = (n, edges, directed)

        def layout_drl(self, **kwargs):
            captured["layout_kwargs"] = kwargs
            return FakeLayout()

    class FakeLayout(list):
        def __init__(self):
            super().__init__([(float(index), 0.0) for index in range(3)])

        def fit_into(self, bounds, *, keep_aspect_ratio):
            captured["fit_into"] = (bounds, keep_aspect_ratio)

    monkeypatch.setattr(force_directed.ig, "Graph", FakeGraph)

    compute_force_directed_positions(dataset)

    assert captured["graph"] == (3, [(0, 1), (1, 2)], False)
    assert "weights" not in captured["layout_kwargs"]
    assert captured["layout_kwargs"]["options"] == {
        "edge_cut": 0.8,
        "init_damping_mult": 0.9,
        "liquid_damping_mult": 0.9,
        "expansion_damping_mult": 0.9,
        "cooldown_damping_mult": 0.9,
        "crunch_damping_mult": 0.9,
        "simmer_damping_mult": 0.9,
    }
    assert len(captured["layout_kwargs"]["seed"]) == 3
    assert captured["fit_into"] == ((-1.0, -1.0, 1.0, 1.0), True)


def test_newick_and_edgelist_use_equivalent_undirected_force_layouts() -> None:
    newick = normalize_dataset(
        NormalizeRequest(
            format="newick",
            dataset_name="newick-star",
            content="(a:1,b:1,c:1)center;",
        )
    ).dataset
    edgelist = normalize_dataset(
        NormalizeRequest(
            format=FORMAT_EDGELIST,
            dataset_name="edgelist-star",
            content=(
                "source,target,distance\n"
                "center,a,1\n"
                "center,b,1\n"
                "center,c,1\n"
            ),
        )
    ).dataset

    assert {
        frozenset((edge.source, edge.target)) for edge in newick.edges
    } == {
        frozenset((edge.source, edge.target)) for edge in edgelist.edges
    }


def test_build_threshold_hierarchy_rejects_missing_distances() -> None:
    dataset = normalize_dataset(
        NormalizeRequest(
            format=FORMAT_EDGELIST,
            dataset_name=DATASET_THRESHOLD,
            content=WEIGHTED_MISSING_DISTANCE,
        )
    ).dataset

    try:
        build_threshold_hierarchy(dataset)
    except ThresholdHierarchyBuildError as err:
        assert "distance" in str(err).lower()
    else:
        raise AssertionError("Expected ThresholdHierarchyBuildError")


def test_build_threshold_hierarchy_accepts_weighted_forest() -> None:
    dataset = normalize_dataset(
        NormalizeRequest(
            format=FORMAT_EDGELIST,
            dataset_name=DATASET_THRESHOLD,
            content=WEIGHTED_FOREST,
        )
    ).dataset

    _, hierarchy = _prepared_threshold_hierarchy(dataset)

    assert len(hierarchy.top_cluster_ids) == 2
    assert sorted(
        hierarchy.clusters[cluster_id].member_node_ids
        for cluster_id in hierarchy.top_cluster_ids
    ) == [["a", "b"], ["c", "d"]]
    assert "threshold_cluster_root" not in hierarchy.clusters
    assert all(
        hierarchy.clusters[cluster_id].parent_cluster_id is None
        for cluster_id in hierarchy.top_cluster_ids
    )


def test_select_visible_slice_uses_threshold_levels_for_weighted_hierarchy() -> None:
    dataset = _weighted_dataset()
    dataset, hierarchy = _prepared_threshold_hierarchy(dataset)

    response = select_visible_slice(
        dataset,
        hierarchy,
        VisibleSliceQuery(
            dataset_id=DATASET_THRESHOLD,
            viewport=Viewport(x=0, y=0, width=8000, height=5000),
            zoom=2.0,
            max_nodes=4,
        ),
    )

    assert response.dataset_id == DATASET_THRESHOLD
    assert response.lod_level == 1
    proxy_id = "cluster_proxy:threshold_cluster_1_a"
    assert [node.id for node in response.nodes] == [proxy_id, "d"]
    assert [node.is_cluster_proxy for node in response.nodes] == [True, False]
    assert [(edge.source, edge.target, edge.distance) for edge in response.edges] == [
        (proxy_id, "d", 4.0),
    ]
    assert all(not edge.id.startswith("hier_") for edge in response.edges)
    assert all(node.x is not None and node.y is not None for node in response.nodes)


def test_select_visible_slice_overview_keeps_connected_tree_aggregated() -> None:
    dataset = _weighted_dataset()
    dataset, hierarchy = _prepared_threshold_hierarchy(dataset)

    response = select_visible_slice(
        dataset,
        hierarchy,
        VisibleSliceQuery(
            dataset_id=DATASET_THRESHOLD,
            viewport=Viewport(x=0, y=0, width=8000, height=5000),
            zoom=1.0,
            max_nodes=10,
        ),
    )

    assert len(response.nodes) == 1
    assert response.nodes[0].is_cluster_proxy is True
    assert response.lod_level == 0
    assert response.edges == []


def test_select_visible_slice_threshold_prefers_viewport_overlap_when_bounded() -> None:
    dataset = _weighted_dataset()
    dataset, hierarchy = _prepared_threshold_hierarchy(dataset)

    response = select_visible_slice(
        dataset,
        hierarchy,
        VisibleSliceQuery(
            dataset_id=DATASET_THRESHOLD,
            viewport=Viewport(x=-120, y=150, width=200, height=240),
            zoom=2.0,
            max_nodes=4,
        ),
    )

    proxy_id = "cluster_proxy:threshold_cluster_1_a"
    assert [node.id for node in response.nodes] == [proxy_id, "d"]
    assert response.nodes[0].is_cluster_proxy is True
    assert [(edge.source, edge.target, edge.distance) for edge in response.edges] == [
        (proxy_id, "d", 4.0),
    ]


def test_select_visible_slice_threshold_forest_shows_multiple_components_without_fake_root() -> (
    None
):
    dataset = normalize_dataset(
        NormalizeRequest(
            format=FORMAT_EDGELIST,
            dataset_name=DATASET_THRESHOLD,
            content=WEIGHTED_FOREST,
        )
    ).dataset
    dataset, hierarchy = _prepared_threshold_hierarchy(dataset)

    response = select_visible_slice(
        dataset,
        hierarchy,
        VisibleSliceQuery(
            dataset_id=DATASET_THRESHOLD,
            viewport=Viewport(x=0, y=0, width=5000, height=5000),
            zoom=0.4,
            max_nodes=10,
        ),
    )

    assert len(response.nodes) == 2
    assert {node.cluster_id for node in response.nodes} == {
        "threshold_cluster_0_a",
        "threshold_cluster_0_c",
    }
    assert all(node.is_cluster_proxy for node in response.nodes)
    assert response.edges == []


def test_select_visible_slice_threshold_forest_zoom_in_reveals_component_detail() -> (
    None
):
    dataset = normalize_dataset(
        NormalizeRequest(
            format=FORMAT_EDGELIST,
            dataset_name=DATASET_THRESHOLD,
            content=WEIGHTED_DEEP_FOREST,
        )
    ).dataset
    dataset, hierarchy = _prepared_threshold_hierarchy(dataset)

    response = select_visible_slice(
        dataset,
        hierarchy,
        VisibleSliceQuery(
            dataset_id=DATASET_THRESHOLD,
            viewport=Viewport(x=0, y=0, width=5000, height=5000),
            zoom=2.0,
            max_nodes=10,
        ),
    )

    assert {node.id for node in response.nodes} == {
        "cluster_proxy:threshold_cluster_1_a",
        "c",
        "cluster_proxy:threshold_cluster_1_d",
        "f",
    }
