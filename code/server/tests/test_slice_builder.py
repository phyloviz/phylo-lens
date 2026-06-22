from collections import Counter

from phylo_lens_server.clustering.slice_builder import (
    build_topology_preserving_visible_graph,
)
from phylo_lens_server.core.models import (
    CanonicalDataset,
    CanonicalEdge,
    CanonicalNode,
    DatasetSource,
    SourceFormat,
    ThresholdHierarchyCluster,
    ThresholdHierarchyIndex,
)


def test_high_boundary_cluster_preserves_tree_topology() -> None:
    nodes = [
        CanonicalNode(id="left_leaf", x=-2, y=1),
        CanonicalNode(id="left_junction", x=-1, y=0),
        CanonicalNode(id="left_bottom", x=-2, y=-1),
        CanonicalNode(id="right_junction", x=1, y=0),
        CanonicalNode(id="right_leaf", x=2, y=1),
        CanonicalNode(id="right_bottom", x=2, y=-1),
    ]
    edges = [
        CanonicalEdge(
            id="left-leaf-edge", source="left_leaf", target="left_junction"
        ),
        CanonicalEdge(
            id="left-bottom-edge", source="left_bottom", target="left_junction"
        ),
        CanonicalEdge(
            id="core-edge", source="left_junction", target="right_junction"
        ),
        CanonicalEdge(
            id="right-leaf-edge", source="right_junction", target="right_leaf"
        ),
        CanonicalEdge(
            id="right-bottom-edge", source="right_junction", target="right_bottom"
        ),
    ]
    dataset = CanonicalDataset(
        dataset_id="tree",
        nodes=nodes,
        edges=edges,
        source=DatasetSource(
            format=SourceFormat.EDGELIST,
            generated_at="1970-01-01T00:00:00+00:00",
        ),
    )
    hierarchy = ThresholdHierarchyIndex(
        dataset_id=dataset.dataset_id,
        top_cluster_ids=[
            "left_leaf",
            "left_bottom",
            "core",
            "right_leaf",
            "right_bottom",
        ],
        clusters={
            node.id: ThresholdHierarchyCluster(
                cluster_id=node.id,
                representative_node_id=node.id,
                member_node_ids=[node.id],
                subtree_size=1,
                distance_threshold_level=1,
            )
            for node in nodes
            if "junction" not in node.id
        }
        | {
            "core": ThresholdHierarchyCluster(
                cluster_id="core",
                representative_node_id="left_junction",
                member_node_ids=["left_junction", "right_junction"],
                subtree_size=2,
                distance_threshold_level=1,
                centroid={"x": 0, "y": 0},
            )
        },
    )
    visible_nodes = [
        node.model_copy(update={"cluster_id": node.id})
        for node in nodes
        if "junction" not in node.id
    ] + [
        CanonicalNode(
            id="cluster_proxy:core",
            x=0,
            y=0,
            cluster_id="core",
            is_cluster_proxy=True,
            subtree_size=2,
        )
    ]

    visible_nodes, visible_edges = build_topology_preserving_visible_graph(
        dataset=dataset,
        hierarchy=hierarchy,
        rendered_cluster_ids=set(hierarchy.top_cluster_ids),
        visible_nodes=visible_nodes,
    )

    degree = Counter()
    for edge in visible_edges:
        degree.update((edge.source, edge.target))

    assert {node.id for node in visible_nodes} == {node.id for node in nodes}
    assert len(visible_edges) == len(visible_nodes) - 1
    assert max(degree.values()) == 3
    assert all(degree[node.id] > 0 for node in visible_nodes)
    assert {
        node.id for node in visible_nodes if node.is_cluster_skeleton is True
    } == {"left_junction", "right_junction"}
