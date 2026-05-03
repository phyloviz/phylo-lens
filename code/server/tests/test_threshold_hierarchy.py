from phylo_lens_server.clustering.selector import select_visible_slice
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
    return normalize_dataset(
        NormalizeRequest(
            format=FORMAT_EDGELIST,
            dataset_name=DATASET_THRESHOLD,
            content=WEIGHTED_CHAIN,
        )
    ).dataset


def test_build_threshold_hierarchy_creates_nested_threshold_levels() -> None:
    dataset = _weighted_dataset()

    hierarchy = build_threshold_hierarchy(dataset)

    assert hierarchy.kind == "threshold"
    root = hierarchy.clusters[hierarchy.root_cluster_id]
    assert root.member_node_ids == ["a", "b", "c", "d"]
    assert root.distance_threshold_level == 0
    assert root.distance_threshold == 4

    child_clusters = [hierarchy.clusters[cluster_id] for cluster_id in root.child_cluster_ids]
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
    assert hierarchy.cluster_ids_by_level[0] == [hierarchy.root_cluster_id]
    assert set(hierarchy.cluster_ids_by_level[1]) == {
        "threshold_cluster_1_a",
        "threshold_cluster_1_d",
    }
    assert 1 in hierarchy.spatial_index_by_level
    level_index = hierarchy.spatial_index_by_level[1]
    assert level_index.root_node_index is not None
    assert len(level_index.nodes) >= 1


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

    hierarchy = build_threshold_hierarchy(dataset)

    root = hierarchy.clusters[hierarchy.root_cluster_id]
    assert root.member_node_ids == ["a", "b", "c", "d"]
    assert len(root.child_cluster_ids) == 2
    assert root.distance_threshold_level == 0
    child_members = sorted(
        hierarchy.clusters[cluster_id].member_node_ids
        for cluster_id in root.child_cluster_ids
    )
    assert child_members == [["a", "b"], ["c", "d"]]


def test_select_visible_slice_uses_threshold_levels_for_weighted_hierarchy() -> None:
    dataset = _weighted_dataset()
    hierarchy = build_threshold_hierarchy(dataset)

    response = select_visible_slice(
        dataset,
        hierarchy,
        VisibleSliceQuery(
            dataset_id=DATASET_THRESHOLD,
            viewport=Viewport(x=0, y=0, width=1000, height=600),
            zoom=2.0,
            max_nodes=4,
        ),
    )

    assert response.dataset_id == DATASET_THRESHOLD
    assert response.lod_level == 1
    assert [node.id for node in response.nodes] == ["a", "b", "d"]
    assert [node.is_cluster_proxy for node in response.nodes] == [False, True, False]
    assert [(edge.source, edge.target) for edge in response.edges] == [
        ("a", "b"),
        ("a", "d"),
    ]
    assert all(node.x is not None and node.y is not None for node in response.nodes)


def test_select_visible_slice_threshold_prefers_viewport_overlap_when_bounded() -> None:
    dataset = _weighted_dataset()
    hierarchy = build_threshold_hierarchy(dataset)

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

    assert [node.id for node in response.nodes] == ["a", "b", "d"]


def test_select_visible_slice_threshold_forest_shows_multiple_components_without_fake_root() -> None:
    dataset = normalize_dataset(
        NormalizeRequest(
            format=FORMAT_EDGELIST,
            dataset_name=DATASET_THRESHOLD,
            content=WEIGHTED_FOREST,
        )
    ).dataset
    hierarchy = build_threshold_hierarchy(dataset)

    response = select_visible_slice(
        dataset,
        hierarchy,
        VisibleSliceQuery(
            dataset_id=DATASET_THRESHOLD,
            viewport=Viewport(x=0, y=0, width=1000, height=600),
            zoom=0.4,
            max_nodes=10,
        ),
    )

    assert len(response.nodes) == 2
    assert {node.id for node in response.nodes}.issubset({"a", "b", "c", "d"})
    assert all(node.is_cluster_proxy for node in response.nodes)
    assert response.edges == []


def test_select_visible_slice_threshold_forest_zoom_in_reveals_component_detail() -> None:
    dataset = normalize_dataset(
        NormalizeRequest(
            format=FORMAT_EDGELIST,
            dataset_name=DATASET_THRESHOLD,
            content=WEIGHTED_DEEP_FOREST,
        )
    ).dataset
    hierarchy = build_threshold_hierarchy(dataset)

    response = select_visible_slice(
        dataset,
        hierarchy,
        VisibleSliceQuery(
            dataset_id=DATASET_THRESHOLD,
            viewport=Viewport(x=0, y=0, width=1000, height=600),
            zoom=2.0,
            max_nodes=10,
        ),
    )

    assert "a" in [node.id for node in response.nodes]
    assert "d" in [node.id for node in response.nodes]
    assert len(response.nodes) > 2
