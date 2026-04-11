from __future__ import annotations

from phylo_lens_server.core.models import (
    CanonicalDataset,
    HierarchyCluster,
    HierarchyIndex,
)

CLUSTER_ID_PREFIX = "cluster"

# Error Types

ERR_HIERARCHY_EMPTY = "Cannot build hierarchy from an empty dataset."
ERR_HIERARCHY_MULTIPLE_PARENTS = (
    "Node '{node_id}' has multiple parents and cannot be represented as a tree."
)
ERR_HIERARCHY_ROOT_COUNT = (
    "Expected exactly one root node for hierarchy construction, found {count}."
)
ERR_HIERARCHY_EDGE_COUNT = "Expected a tree with node_count - 1 edges, found {edge_count} edges for {node_count} nodes."
ERR_HIERARCHY_DISCONNECTED = (
    "Dataset is disconnected or cyclic and cannot be represented as one tree."
)


class HierarchyBuildError(ValueError):
    """Raised when a canonical dataset cannot be converted into a tree hierarchy."""


def build_tree_hierarchy(dataset: CanonicalDataset) -> HierarchyIndex:
    """Build a deterministic hierarchy index from a canonical tree dataset."""
    if not dataset.nodes:
        raise HierarchyBuildError(ERR_HIERARCHY_EMPTY)

    node_ids = sorted(node.id for node in dataset.nodes)
    node_id_set = set(node_ids)

    if len(dataset.edges) != len(dataset.nodes) - 1:
        raise HierarchyBuildError(
            ERR_HIERARCHY_EDGE_COUNT.format(
                edge_count=len(dataset.edges),
                node_count=len(dataset.nodes),
            )
        )

    children_by_parent: dict[str, list[str]] = {node_id: [] for node_id in node_ids}
    incoming_count = {node_id: 0 for node_id in node_ids}

    for edge in dataset.edges:
        if edge.source not in node_id_set or edge.target not in node_id_set:
            raise HierarchyBuildError(ERR_HIERARCHY_DISCONNECTED)
        incoming_count[edge.target] += 1
        if incoming_count[edge.target] > 1:
            raise HierarchyBuildError(
                ERR_HIERARCHY_MULTIPLE_PARENTS.format(node_id=edge.target)
            )
        children_by_parent[edge.source].append(edge.target)

    for children in children_by_parent.values():
        children.sort()

    roots = [node_id for node_id in node_ids if incoming_count[node_id] == 0]
    if len(roots) != 1:
        raise HierarchyBuildError(ERR_HIERARCHY_ROOT_COUNT.format(count=len(roots)))

    root_id = roots[0]
    stack: list[tuple[str, int]] = [(root_id, 0)]
    traversal_order: list[str] = []
    parent_by_node: dict[str, str | None] = {root_id: None}
    depth_by_node: dict[str, int] = {root_id: 0}

    while stack:
        node_id, depth = stack.pop()
        traversal_order.append(node_id)

        children = children_by_parent[node_id]
        for child_id in reversed(children):
            if child_id in depth_by_node:
                raise HierarchyBuildError(ERR_HIERARCHY_DISCONNECTED)
            parent_by_node[child_id] = node_id
            depth_by_node[child_id] = depth + 1
            stack.append((child_id, depth + 1))

    if len(traversal_order) != len(node_ids):
        raise HierarchyBuildError(ERR_HIERARCHY_DISCONNECTED)

    clusters: dict[str, HierarchyCluster] = {}
    subtree_size_by_node: dict[str, int] = {}
    max_depth_by_node: dict[str, int] = {}

    for node_id in reversed(traversal_order):
        children = children_by_parent[node_id]
        depth = depth_by_node[node_id]

        subtree_size = 1
        max_depth = depth
        for child_id in children:
            subtree_size += subtree_size_by_node[child_id]
            child_max_depth = max_depth_by_node[child_id]
            if child_max_depth > max_depth:
                max_depth = child_max_depth

        subtree_size_by_node[node_id] = subtree_size
        max_depth_by_node[node_id] = max_depth

        cluster_id = _cluster_id_for_node(node_id)
        parent_node_id = parent_by_node[node_id]
        parent_cluster_id = (
            _cluster_id_for_node(parent_node_id) if parent_node_id is not None else None
        )
        child_cluster_ids = [_cluster_id_for_node(child_id) for child_id in children]

        clusters[cluster_id] = HierarchyCluster(
            cluster_id=cluster_id,
            parent_cluster_id=parent_cluster_id,
            child_cluster_ids=child_cluster_ids,
            representative_node_id=node_id,
            subtree_size=subtree_size,
            depth=depth,
            min_depth=depth,
            max_depth=max_depth,
        )

    return HierarchyIndex(
        dataset_id=dataset.dataset_id,
        root_cluster_id=_cluster_id_for_node(root_id),
        clusters=clusters,
    )


def _cluster_id_for_node(node_id: str) -> str:
    return f"{CLUSTER_ID_PREFIX}_{node_id}"
