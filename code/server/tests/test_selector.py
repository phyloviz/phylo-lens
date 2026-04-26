from phylo_lens_server.clustering.hierarchy import build_tree_hierarchy
from phylo_lens_server.clustering.selector import select_visible_slice
from phylo_lens_server.core.models import Viewport, VisibleSliceQuery
from phylo_lens_server.data.normalizer import NormalizeRequest, normalize_dataset

FORMAT_NEWICK = "newick"
DATASET_BALANCED = "balanced-tree"
BALANCED_NEWICK = "((A,B)X,(C,D)Y)Root;"


def _balanced_dataset_and_hierarchy():
    dataset = normalize_dataset(
        NormalizeRequest(
            format=FORMAT_NEWICK,
            dataset_name=DATASET_BALANCED,
            content=BALANCED_NEWICK,
        )
    ).dataset
    hierarchy = build_tree_hierarchy(dataset)
    return dataset, hierarchy


def _viewport() -> Viewport:
    return Viewport(x=0, y=0, width=1000, height=600)


def _viewport_at(x: float, y: float, width: float, height: float) -> Viewport:
    return Viewport(x=x, y=y, width=width, height=height)


def test_select_visible_slice_returns_overview_at_low_zoom() -> None:
    """Confirm low zoom shows contracted cluster representatives and their edges."""
    dataset, hierarchy = _balanced_dataset_and_hierarchy()

    response = select_visible_slice(
        dataset,
        hierarchy,
        VisibleSliceQuery(
            dataset_id=DATASET_BALANCED,
            viewport=_viewport(),
            zoom=0.4,
        ),
    )

    assert response.lod_level == 0
    assert [node.id for node in response.nodes] == ["root", "x", "y"]
    assert [
        (node.id, node.is_cluster_proxy, node.subtree_size, node.leaf_count)
        for node in response.nodes
    ] == [
        ("root", True, 7, 4),
        ("x", True, 3, 2),
        ("y", True, 3, 2),
    ]
    assert [(edge.source, edge.target) for edge in response.edges] == [
        ("root", "x"),
        ("root", "y"),
    ]
    assert [cluster.cluster_id for cluster in response.collapsed_clusters] == [
        "cluster_x",
        "cluster_y",
    ]
    assert response.view_meta.returned_node_count == 3
    assert response.view_meta.returned_edge_count == 2


def test_select_visible_slice_returns_full_detail_at_higher_zoom() -> None:
    """Confirm higher zoom expands the hierarchy to leaf-level detail."""
    dataset, hierarchy = _balanced_dataset_and_hierarchy()

    response = select_visible_slice(
        dataset,
        hierarchy,
        VisibleSliceQuery(
            dataset_id=DATASET_BALANCED,
            viewport=_viewport(),
            zoom=2.0,
        ),
    )

    assert response.lod_level == 2
    assert [node.id for node in response.nodes] == [
        "root",
        "x",
        "y",
        "a",
        "b",
        "c",
        "d",
    ]
    assert [(node.id, node.x, node.y) for node in response.nodes] == [
        ("root", 0.0, 0.0),
        ("x", -1.0, 1.0),
        ("y", 1.0, 1.0),
        ("a", -1.5, 2.0),
        ("b", -0.5, 2.0),
        ("c", 0.5, 2.0),
        ("d", 1.5, 2.0),
    ]
    assert [(edge.source, edge.target) for edge in response.edges] == [
        ("root", "x"),
        ("root", "y"),
        ("x", "a"),
        ("x", "b"),
        ("y", "c"),
        ("y", "d"),
    ]
    assert response.collapsed_clusters == []
    assert response.view_meta.returned_node_count == 7
    assert response.view_meta.returned_edge_count == 6


def test_select_visible_slice_respects_max_nodes_bound() -> None:
    """Confirm max_nodes caps expansion and keeps the output bounded."""
    dataset, hierarchy = _balanced_dataset_and_hierarchy()

    response = select_visible_slice(
        dataset,
        hierarchy,
        VisibleSliceQuery(
            dataset_id=DATASET_BALANCED,
            viewport=_viewport(),
            zoom=2.0,
            max_nodes=4,
        ),
    )

    assert [node.id for node in response.nodes] == ["root", "x", "y"]
    assert [(edge.source, edge.target) for edge in response.edges] == [
        ("root", "x"),
        ("root", "y"),
    ]
    assert response.view_meta.returned_node_count <= 4
    assert response.collapsed_clusters == []


def test_select_visible_slice_prefers_lod_hint_when_present() -> None:
    """Confirm explicit lod hints override zoom-derived depth selection."""
    dataset, hierarchy = _balanced_dataset_and_hierarchy()

    response = select_visible_slice(
        dataset,
        hierarchy,
        VisibleSliceQuery(
            dataset_id=DATASET_BALANCED,
            viewport=_viewport(),
            zoom=2.0,
            lod_hint=1,
        ),
    )

    assert response.lod_level == 1
    assert [node.id for node in response.nodes] == ["root", "x", "y"]
    assert [node.is_cluster_proxy for node in response.nodes] == [False, True, True]




def test_select_visible_slice_is_deterministic() -> None:
    """Confirm repeated identical queries produce the same visible slice."""
    dataset, hierarchy = _balanced_dataset_and_hierarchy()
    query = VisibleSliceQuery(
        dataset_id=DATASET_BALANCED,
        viewport=_viewport(),
        zoom=2.0,
        max_nodes=4,
    )

    first = select_visible_slice(dataset, hierarchy, query)
    second = select_visible_slice(dataset, hierarchy, query)

    assert first.model_dump() == second.model_dump()


def test_select_visible_slice_prioritizes_focus_branch_when_bounded() -> None:
    """Confirm a focus node biases bounded expansion toward the relevant subtree."""
    dataset, hierarchy = _balanced_dataset_and_hierarchy()

    response = select_visible_slice(
        dataset,
        hierarchy,
        VisibleSliceQuery(
            dataset_id=DATASET_BALANCED,
            viewport=_viewport(),
            zoom=3.0,
            max_nodes=5,
            focus_node_id="c",
        ),
    )

    assert [node.id for node in response.nodes] == ["root", "y", "x", "c", "d"]
    assert [(edge.source, edge.target) for edge in response.edges] == [
        ("root", "x"),
        ("root", "y"),
        ("y", "c"),
        ("y", "d"),
    ]


def test_select_visible_slice_prioritizes_viewport_overlap_when_bounded() -> None:
    """Confirm viewport overlap biases bounded expansion toward the visible subtree."""
    dataset, hierarchy = _balanced_dataset_and_hierarchy()

    response = select_visible_slice(
        dataset,
        hierarchy,
        VisibleSliceQuery(
            dataset_id=DATASET_BALANCED,
            viewport=_viewport_at(x=-120, y=150, width=200, height=240),
            zoom=2.0,
            max_nodes=5,
        ),
    )

    assert [node.id for node in response.nodes] == ["root", "x", "y", "a", "b"]
    assert [(edge.source, edge.target) for edge in response.edges] == [
        ("root", "x"),
        ("root", "y"),
        ("x", "a"),
        ("x", "b"),
    ]
