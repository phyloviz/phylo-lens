from phylo_lens_server.clustering.hierarchy import build_tree_hierarchy
from phylo_lens_server.clustering.selector import (
    VisibleSliceSelectionError,
    select_visible_slice,
)
from phylo_lens_server.clustering.threshold_hierarchy import build_threshold_hierarchy
from phylo_lens_server.core.models import Viewport, VisibleSliceQuery
from phylo_lens_server.data.normalizer import NormalizeRequest, normalize_dataset

FORMAT_EDGELIST = "edgelist"
FORMAT_NEWICK = "newick"
DATASET_THRESHOLD = "threshold-tree"
DATASET_BALANCED = "balanced-tree"
WEIGHTED_CHAIN = "source,target,distance\na,b,1\nb,c,2\nc,d,4\n"
BALANCED_NEWICK = "((A,B)X,(C,D)Y)Root;"


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


def _legacy_tree_dataset_and_hierarchy():
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


def test_select_visible_slice_rejects_legacy_tree_hierarchies() -> None:
    dataset, hierarchy = _legacy_tree_dataset_and_hierarchy()

    try:
        select_visible_slice(
            dataset,
            hierarchy,
            VisibleSliceQuery(
                dataset_id=DATASET_BALANCED,
                viewport=_viewport(),
                zoom=2.0,
            ),
        )
    except VisibleSliceSelectionError as err:
        assert "distance-threshold" in str(err)
    else:
        raise AssertionError("Expected VisibleSliceSelectionError")
