from phylo_lens_server.clustering.hierarchy import (
    ERR_HIERARCHY_MULTIPLE_PARENTS,
    HierarchyBuildError,
    build_tree_hierarchy,
)
from phylo_lens_server.data.normalizer import NormalizeRequest, normalize_dataset

FORMAT_NEWICK = "newick"
FORMAT_EDGELIST = "edgelist"

DATASET_BALANCED = "balanced-tree"
DATASET_SKEWED = "skewed-tree"
DATASET_MULTI_PARENT = "multi-parent"

BALANCED_NEWICK = "((A,B)X,(C,D)Y)Root;"
SKEWED_NEWICK = "(((A)B)C)Root;"
MULTI_PARENT_EDGELIST = "source,target\nroot,b\na,b\n"


def test_build_tree_hierarchy_is_deterministic() -> None:
    """Confirm repeated hierarchy builds over the same dataset remain stable."""
    dataset = normalize_dataset(
        NormalizeRequest(
            format=FORMAT_NEWICK,
            dataset_name=DATASET_BALANCED,
            content=BALANCED_NEWICK,
        )
    ).dataset

    first = build_tree_hierarchy(dataset)
    second = build_tree_hierarchy(dataset)

    assert first.model_dump() == second.model_dump()


def test_build_tree_hierarchy_balanced_tree_statistics() -> None:
    """Confirm subtree size and depth statistics match balanced input topology."""
    dataset = normalize_dataset(
        NormalizeRequest(
            format=FORMAT_NEWICK,
            dataset_name=DATASET_BALANCED,
            content=BALANCED_NEWICK,
        )
    ).dataset

    hierarchy = build_tree_hierarchy(dataset)

    assert hierarchy.root_cluster_id == "cluster_root"
    assert set(hierarchy.clusters) == {
        "cluster_root",
        "cluster_x",
        "cluster_y",
        "cluster_a",
        "cluster_b",
        "cluster_c",
        "cluster_d",
    }

    root = hierarchy.clusters["cluster_root"]
    cluster_x = hierarchy.clusters["cluster_x"]
    cluster_a = hierarchy.clusters["cluster_a"]

    assert root.child_cluster_ids == ["cluster_x", "cluster_y"]
    assert root.subtree_size == 7
    assert root.depth == 0
    assert root.min_depth == 0
    assert root.max_depth == 2
    assert root.centroid == {"x": 0.0, "y": 0.0}
    assert root.bounds == {"min_x": -1.5, "max_x": 1.5, "min_y": 0.0, "max_y": 2.0}

    assert cluster_x.parent_cluster_id == "cluster_root"
    assert cluster_x.child_cluster_ids == ["cluster_a", "cluster_b"]
    assert cluster_x.subtree_size == 3
    assert cluster_x.depth == 1
    assert cluster_x.min_depth == 1
    assert cluster_x.max_depth == 2
    assert cluster_x.centroid == {"x": -1.0, "y": 1.0}

    assert cluster_a.parent_cluster_id == "cluster_x"
    assert cluster_a.child_cluster_ids == []
    assert cluster_a.subtree_size == 1
    assert cluster_a.depth == 2
    assert cluster_a.min_depth == 2
    assert cluster_a.max_depth == 2
    assert cluster_a.centroid == {"x": -1.5, "y": 2.0}


def test_build_tree_hierarchy_handles_skewed_trees() -> None:
    """Confirm skewed topologies still produce correct depth ranges and size counts."""
    dataset = normalize_dataset(
        NormalizeRequest(
            format=FORMAT_NEWICK,
            dataset_name=DATASET_SKEWED,
            content=SKEWED_NEWICK,
        )
    ).dataset

    hierarchy = build_tree_hierarchy(dataset)

    assert hierarchy.root_cluster_id == "cluster_root"
    assert hierarchy.clusters["cluster_root"].subtree_size == 4
    assert hierarchy.clusters["cluster_root"].max_depth == 3
    assert hierarchy.clusters["cluster_c"].depth == 1
    assert hierarchy.clusters["cluster_b"].depth == 2
    assert hierarchy.clusters["cluster_a"].depth == 3


def test_build_tree_hierarchy_covers_every_canonical_node_once() -> None:
    """Confirm hierarchy clusters map one-to-one with canonical nodes in the MVP."""
    dataset = normalize_dataset(
        NormalizeRequest(
            format=FORMAT_NEWICK,
            dataset_name=DATASET_BALANCED,
            content=BALANCED_NEWICK,
        )
    ).dataset

    hierarchy = build_tree_hierarchy(dataset)

    representative_ids = {
        cluster.representative_node_id for cluster in hierarchy.clusters.values()
    }
    assert representative_ids == {node.id for node in dataset.nodes}
    assert len(hierarchy.clusters) == len(dataset.nodes)


def test_build_tree_hierarchy_rejects_multi_parent_graphs() -> None:
    """Confirm hierarchy build fails when the canonical graph is not tree-shaped."""
    dataset = normalize_dataset(
        NormalizeRequest(
            format=FORMAT_EDGELIST,
            dataset_name=DATASET_MULTI_PARENT,
            content=MULTI_PARENT_EDGELIST,
        )
    ).dataset

    try:
        build_tree_hierarchy(dataset)
    except HierarchyBuildError as err:
        assert ERR_HIERARCHY_MULTIPLE_PARENTS.format(node_id="b") == str(err)
    else:
        raise AssertionError("Expected HierarchyBuildError for multi-parent graph")
