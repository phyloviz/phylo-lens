from phylo_lens_server.clustering.selector import select_visible_slice
from phylo_lens_server.clustering.threshold_hierarchy import build_threshold_hierarchy
from phylo_lens_server.core.models import (
    CanonicalDataset,
    CanonicalNode,
    DatasetSource,
    SourceFormat,
    ThresholdHierarchyCluster,
    ThresholdHierarchyIndex,
    Viewport,
    VisibleSliceQuery,
)
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
    hierarchy = build_threshold_hierarchy(dataset)
    return dataset, hierarchy


def _viewport() -> Viewport:
    return Viewport(x=0, y=0, width=1000, height=600)


def _viewport_relevance_dataset_and_hierarchy():
    dataset = CanonicalDataset(
        dataset_id="viewport-tree",
        nodes=[
            CanonicalNode(id="root"),
            CanonicalNode(id="left"),
            CanonicalNode(id="right"),
            CanonicalNode(id="left_leaf"),
            CanonicalNode(id="right_leaf"),
        ],
        edges=[],
        source=DatasetSource(
            format=SourceFormat.EDGELIST,
            generated_at="1970-01-01T00:00:00+00:00",
        ),
    )
    hierarchy = ThresholdHierarchyIndex(
        dataset_id=dataset.dataset_id,
        root_cluster_id="cluster_root",
        max_distance_threshold_level=2,
        cluster_ids_by_level={
            0: ["cluster_root"],
            1: ["cluster_left", "cluster_right"],
            2: ["cluster_left_leaf", "cluster_right_leaf"],
        },
        clusters={
            "cluster_root": ThresholdHierarchyCluster(
                cluster_id="cluster_root",
                child_cluster_ids=["cluster_left", "cluster_right"],
                representative_node_id="root",
                member_node_ids=[
                    "root",
                    "left",
                    "right",
                    "left_leaf",
                    "right_leaf",
                ],
                subtree_size=5,
                distance_threshold_level=0,
                bounds={"min_x": -10, "max_x": 10, "min_y": -1, "max_y": 1},
                centroid={"x": 0, "y": 0},
            ),
            "cluster_left": ThresholdHierarchyCluster(
                cluster_id="cluster_left",
                parent_cluster_id="cluster_root",
                child_cluster_ids=["cluster_left_leaf"],
                representative_node_id="left",
                member_node_ids=["left", "left_leaf"],
                subtree_size=2,
                distance_threshold_level=1,
                bounds={"min_x": -10, "max_x": -8, "min_y": -1, "max_y": 1},
                centroid={"x": -9, "y": 0},
            ),
            "cluster_right": ThresholdHierarchyCluster(
                cluster_id="cluster_right",
                parent_cluster_id="cluster_root",
                child_cluster_ids=["cluster_right_leaf"],
                representative_node_id="right",
                member_node_ids=["right", "right_leaf"],
                subtree_size=2,
                distance_threshold_level=1,
                bounds={"min_x": 8, "max_x": 10, "min_y": -1, "max_y": 1},
                centroid={"x": 9, "y": 0},
            ),
            "cluster_left_leaf": ThresholdHierarchyCluster(
                cluster_id="cluster_left_leaf",
                parent_cluster_id="cluster_left",
                representative_node_id="left_leaf",
                member_node_ids=["left_leaf"],
                subtree_size=1,
                distance_threshold_level=2,
                bounds={"min_x": -9.1, "max_x": -8.9, "min_y": -0.1, "max_y": 0.1},
                centroid={"x": -9, "y": 0},
            ),
            "cluster_right_leaf": ThresholdHierarchyCluster(
                cluster_id="cluster_right_leaf",
                parent_cluster_id="cluster_right",
                representative_node_id="right_leaf",
                member_node_ids=["right_leaf"],
                subtree_size=1,
                distance_threshold_level=2,
                bounds={"min_x": 8.9, "max_x": 9.1, "min_y": -0.1, "max_y": 0.1},
                centroid={"x": 9, "y": 0},
            ),
        },
    )

    return dataset, hierarchy


def test_select_visible_slice_is_deterministic_for_threshold_hierarchies() -> None:
    dataset, hierarchy = _threshold_dataset_and_hierarchy()
    query = VisibleSliceQuery(
        dataset_id=DATASET_THRESHOLD,
        viewport=_viewport(),
        zoom=2.0,
        max_nodes=4,
    )

    first = select_visible_slice(dataset, hierarchy, query)
    second = select_visible_slice(dataset, hierarchy, query)

    assert first.model_dump() == second.model_dump()
    assert first.view_meta.global_bounds is not None
    assert first.view_meta.global_bounds.min_x < first.view_meta.global_bounds.max_x
    assert first.view_meta.global_bounds.min_y < first.view_meta.global_bounds.max_y


def test_select_visible_slice_prioritizes_focus_branch_when_bounded() -> None:
    dataset, hierarchy = _threshold_dataset_and_hierarchy()

    response = select_visible_slice(
        dataset,
        hierarchy,
        VisibleSliceQuery(
            dataset_id=DATASET_THRESHOLD,
            viewport=_viewport(),
            zoom=3.0,
            max_nodes=3,
            focus_node_id="d",
        ),
    )

    assert [node.id for node in response.nodes] == ["a", "d", "b"]
    assert response.nodes[1].id == "d"
    assert {(edge.source, edge.target) for edge in response.edges} == {
        ("a", "d"),
        ("a", "b"),
    }


def test_select_visible_slice_expands_only_viewport_relevant_clusters() -> None:
    dataset, hierarchy = _viewport_relevance_dataset_and_hierarchy()

    response = select_visible_slice(
        dataset,
        hierarchy,
        VisibleSliceQuery(
            dataset_id=dataset.dataset_id,
            viewport=Viewport(x=-1350, y=0, width=300, height=600),
            zoom=3.0,
            max_nodes=10,
        ),
    )

    assert [node.id for node in response.nodes] == ["root", "left", "left_leaf"]
    assert "right" not in {node.id for node in response.nodes}
    assert {(edge.source, edge.target) for edge in response.edges} == {
        ("root", "left"),
        ("left", "left_leaf"),
    }
    assert response.view_meta.global_bounds is not None
    assert response.view_meta.global_bounds.min_x == -1500
    assert response.view_meta.global_bounds.max_x == 1500


def test_select_visible_slice_expands_requested_cluster_below_zoom_threshold() -> None:
    # Given
    dataset, hierarchy = _viewport_relevance_dataset_and_hierarchy()
    query = VisibleSliceQuery(
        dataset_id=dataset.dataset_id,
        viewport=Viewport(x=0, y=0, width=4000, height=600),
        zoom=0.4,
        max_nodes=10,
        expanded_cluster_ids=["cluster_root"],
    )

    # When
    response = select_visible_slice(dataset, hierarchy, query)

    # Then
    assert [node.id for node in response.nodes] == ["root", "left", "right"]
    assert {(edge.source, edge.target) for edge in response.edges} == {
        ("root", "left"),
        ("root", "right"),
    }


def test_select_visible_slice_keeps_requested_cluster_collapsed_above_zoom_threshold() -> None:
    # Given
    dataset, hierarchy = _viewport_relevance_dataset_and_hierarchy()
    query = VisibleSliceQuery(
        dataset_id=dataset.dataset_id,
        viewport=Viewport(x=-1350, y=0, width=300, height=600),
        zoom=3.0,
        max_nodes=10,
        collapsed_cluster_ids=["cluster_left"],
    )

    # When
    response = select_visible_slice(dataset, hierarchy, query)

    # Then
    left_node = next(node for node in response.nodes if node.id == "left")

    assert [node.id for node in response.nodes] == ["root", "left"]
    assert "left_leaf" not in {node.id for node in response.nodes}
    assert left_node.cluster_id == "cluster_left"
    assert left_node.is_cluster_proxy is True
    assert {(edge.source, edge.target) for edge in response.edges} == {
        ("root", "left"),
    }


def test_select_visible_slice_collapsed_cluster_wins_over_expanded_cluster() -> None:
    # Given
    dataset, hierarchy = _viewport_relevance_dataset_and_hierarchy()
    query = VisibleSliceQuery(
        dataset_id=dataset.dataset_id,
        viewport=Viewport(x=-1350, y=0, width=300, height=600),
        zoom=3.0,
        max_nodes=10,
        expanded_cluster_ids=["cluster_left"],
        collapsed_cluster_ids=["cluster_left"],
    )

    # When
    response = select_visible_slice(dataset, hierarchy, query)

    # Then
    left_node = next(node for node in response.nodes if node.id == "left")

    assert [node.id for node in response.nodes] == ["root", "left"]
    assert "left_leaf" not in {node.id for node in response.nodes}
    assert left_node.cluster_id == "cluster_left"
    assert left_node.is_cluster_proxy is True
    assert {(edge.source, edge.target) for edge in response.edges} == {
        ("root", "left"),
    }


def test_select_visible_slice_keeps_focus_cluster_path_view_relevant() -> None:
    # Given
    dataset, hierarchy = _viewport_relevance_dataset_and_hierarchy()
    query = VisibleSliceQuery(
        dataset_id=dataset.dataset_id,
        viewport=Viewport(x=-1350, y=0, width=300, height=600),
        zoom=3.0,
        max_nodes=10,
        focus_cluster_id="cluster_right",
    )

    # When
    response = select_visible_slice(dataset, hierarchy, query)

    # Then
    right_node = next(node for node in response.nodes if node.id == "right")

    assert "right" in {node.id for node in response.nodes}
    assert right_node.cluster_id == "cluster_right"
    assert right_node.is_cluster_proxy is True
    assert {(edge.source, edge.target) for edge in response.edges} == {
        ("root", "right"),
        ("root", "left"),
        ("left", "left_leaf"),
    }
