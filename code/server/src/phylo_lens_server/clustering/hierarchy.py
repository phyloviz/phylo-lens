from __future__ import annotations

from dataclasses import dataclass
from collections import deque

from phylo_lens_server.core.models import (
    CanonicalDataset,
    CanonicalEdge,
    HierarchyCluster,
    HierarchyIndex,
)

CLUSTER_ID_PREFIX = "cluster"

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

type Stack = list[tuple[int, bool]]


class HierarchyBuildError(ValueError):
    """Raised when a canonical dataset cannot be converted into a tree hierarchy."""


@dataclass(frozen=True)
class _HierarchyArrays:
    node_ids: list[str]
    parent_index: list[int]
    child_indices: list[list[int]]
    depth: list[int]
    preorder: list[int]
    postorder: list[int]
    root_index: int


@dataclass(frozen=True)
class _UndirectedTreeTopology:
    node_ids: list[str]
    index_by_node_id: dict[str, int]
    adjacency: list[list[int]]
    edge_by_pair: dict[tuple[int, int], CanonicalEdge]


def build_tree_hierarchy(
    dataset: CanonicalDataset,
    *,
    assume_oriented: bool = False,
) -> HierarchyIndex:
    """Build a deterministic hierarchy index from a canonical tree dataset."""
    if not dataset.nodes:
        raise HierarchyBuildError(ERR_HIERARCHY_EMPTY)

    oriented_dataset = dataset if assume_oriented else orient_tree_dataset(dataset)
    arrays = _build_hierarchy_arrays(oriented_dataset)
    clusters = _build_clusters(arrays)

    return HierarchyIndex(
        dataset_id=oriented_dataset.dataset_id,
        root_cluster_id=_cluster_id_for_node(arrays.node_ids[arrays.root_index]),
        clusters=clusters,
    )


def orient_tree_dataset(dataset: CanonicalDataset) -> CanonicalDataset:
    """Orient a tree-shaped dataset deterministically for hierarchy processing."""
    if not dataset.nodes:
        raise HierarchyBuildError(ERR_HIERARCHY_EMPTY)

    topology = _build_undirected_tree_topology(dataset)

    if _is_existing_orientation_rooted_tree(dataset, topology.index_by_node_id):
        return dataset

    root_index = _select_tree_center_root(topology.node_ids, topology.adjacency)
    oriented_edges: list[CanonicalEdge] = []
    visited = [False] * len(topology.node_ids)
    visited[root_index] = True
    stack = [root_index]

    while stack:
        node_index = stack.pop()
        for child_index in reversed(topology.adjacency[node_index]):
            if visited[child_index]:
                continue
            visited[child_index] = True
            original_edge = topology.edge_by_pair[
                _normalized_pair(node_index, child_index)
            ]
            oriented_edges.append(
                CanonicalEdge(
                    id=original_edge.id,
                    source=topology.node_ids[node_index],
                    target=topology.node_ids[child_index],
                    distance=original_edge.distance,
                )
            )
            stack.append(child_index)

    if not all(visited):
        raise HierarchyBuildError(ERR_HIERARCHY_DISCONNECTED)

    oriented_edges.sort(key=lambda edge: (edge.source, edge.target, edge.id))

    return CanonicalDataset(
        dataset_id=dataset.dataset_id,
        nodes=dataset.nodes,
        edges=oriented_edges,
        metadata_schema=dataset.metadata_schema,
        metadata_by_node_id=dataset.metadata_by_node_id,
        source=dataset.source,
    )


def _build_hierarchy_arrays(dataset: CanonicalDataset) -> _HierarchyArrays:
    node_ids = sorted(node.id for node in dataset.nodes)
    node_count = len(node_ids)

    if len(dataset.edges) != node_count - 1:
        raise HierarchyBuildError(
            ERR_HIERARCHY_EDGE_COUNT.format(
                edge_count=len(dataset.edges),
                node_count=node_count,
            )
        )

    index_by_node_id = {node_id: index for index, node_id in enumerate(node_ids)}
    parent_index = [-1] * node_count
    child_indices = [[] for _ in range(node_count)]
    incoming_count = [0] * node_count

    for edge in dataset.edges:
        source_index = index_by_node_id.get(edge.source)
        target_index = index_by_node_id.get(edge.target)
        if source_index is None or target_index is None:
            raise HierarchyBuildError(ERR_HIERARCHY_DISCONNECTED)

        incoming_count[target_index] += 1
        if incoming_count[target_index] > 1:
            raise HierarchyBuildError(
                ERR_HIERARCHY_MULTIPLE_PARENTS.format(node_id=edge.target)
            )

        parent_index[target_index] = source_index
        child_indices[source_index].append(target_index)

    for siblings in child_indices:
        siblings.sort(key=node_ids.__getitem__)

    root_indices = [index for index, count in enumerate(incoming_count) if count == 0]
    if len(root_indices) != 1:
        raise HierarchyBuildError(ERR_HIERARCHY_ROOT_COUNT.format(count=len(root_indices)))
    root_index = root_indices[0]

    preorder: list[int] = []
    postorder: list[int] = []
    depth = [-1] * node_count
    depth[root_index] = 0
    
    stack: Stack = [(root_index, False)]
    while stack:
        node_index, expanded = stack.pop()
        if expanded:
            postorder.append(node_index)
            continue

        preorder.append(node_index)
        stack.append((node_index, True))

        next_depth = depth[node_index] + 1
        for child_index in reversed(child_indices[node_index]):
            if depth[child_index] != -1:
                raise HierarchyBuildError(ERR_HIERARCHY_DISCONNECTED)
            depth[child_index] = next_depth
            stack.append((child_index, False))

    if len(preorder) != node_count:
        raise HierarchyBuildError(ERR_HIERARCHY_DISCONNECTED)
    return _HierarchyArrays(
        node_ids=node_ids,
        parent_index=parent_index,
        child_indices=child_indices,
        depth=depth,
        preorder=preorder,
        postorder=postorder,
        root_index=root_index,
    )


def _build_undirected_tree_topology(dataset: CanonicalDataset) -> _UndirectedTreeTopology:
    node_ids = sorted(node.id for node in dataset.nodes)
    node_count = len(node_ids)
    if len(dataset.edges) != node_count - 1:
        raise HierarchyBuildError(
            ERR_HIERARCHY_EDGE_COUNT.format(
                edge_count=len(dataset.edges),
                node_count=node_count,
            )
        )

    index_by_node_id = {node_id: index for index, node_id in enumerate(node_ids)}
    adjacency: list[list[int]] = [[] for _ in range(node_count)]
    edge_by_pair: dict[tuple[int, int], CanonicalEdge] = {}

    for edge in dataset.edges:
        source_index = index_by_node_id.get(edge.source)
        target_index = index_by_node_id.get(edge.target)
        if source_index is None or target_index is None:
            raise HierarchyBuildError(ERR_HIERARCHY_DISCONNECTED)

        pair = _normalized_pair(source_index, target_index)
        if pair in edge_by_pair:
            raise HierarchyBuildError(ERR_HIERARCHY_DISCONNECTED)

        edge_by_pair[pair] = edge
        adjacency[source_index].append(target_index)
        adjacency[target_index].append(source_index)

    for neighbors in adjacency:
        neighbors.sort(key=node_ids.__getitem__)

    _assert_connected(adjacency)
    return _UndirectedTreeTopology(
        node_ids=node_ids,
        index_by_node_id=index_by_node_id,
        adjacency=adjacency,
        edge_by_pair=edge_by_pair,
    )


def _build_clusters(arrays: _HierarchyArrays) -> dict[str, HierarchyCluster]:
    node_count = len(arrays.node_ids)
    subtree_size = [1] * node_count
    leaf_count = [1] * node_count
    max_depth = arrays.depth.copy()
    preorder_index = [0] * node_count
    postorder_index = [0] * node_count
    x_by_index = [0.0] * node_count
    min_x = [0.0] * node_count
    max_x = [0.0] * node_count

    for order, node_index in enumerate(arrays.preorder):
        preorder_index[node_index] = order
    for order, node_index in enumerate(arrays.postorder):
        postorder_index[node_index] = order

    next_leaf_x = 0.0
    for node_index in arrays.postorder:
        children = arrays.child_indices[node_index]
        if not children:
            x_by_index[node_index] = next_leaf_x
            min_x[node_index] = next_leaf_x
            max_x[node_index] = next_leaf_x
            next_leaf_x += 1.0
            continue

        span_sum = 0.0
        subtree_total = 1
        leaf_total = 0
        max_child_depth = arrays.depth[node_index]
        child_min_x = float("inf")
        child_max_x = float("-inf")

        for child_index in children:
            subtree_total += subtree_size[child_index]
            leaf_total += leaf_count[child_index]
            span_sum += x_by_index[child_index]
            child_min_x = min(child_min_x, min_x[child_index])
            child_max_x = max(child_max_x, max_x[child_index])
            if max_depth[child_index] > max_child_depth:
                max_child_depth = max_depth[child_index]

        subtree_size[node_index] = subtree_total
        leaf_count[node_index] = leaf_total
        max_depth[node_index] = max_child_depth
        x_by_index[node_index] = span_sum / len(children)
        min_x[node_index] = child_min_x
        max_x[node_index] = child_max_x

    root_x = x_by_index[arrays.root_index]
    if root_x != 0:
        x_by_index = [x - root_x for x in x_by_index]
        min_x = [value - root_x for value in min_x]
        max_x = [value - root_x for value in max_x]

    clusters: dict[str, HierarchyCluster] = {}
    for node_index, node_id in enumerate(arrays.node_ids):
        parent = arrays.parent_index[node_index]
        parent_cluster_id = (
            _cluster_id_for_node(arrays.node_ids[parent]) if parent != -1 else None
        )
        child_cluster_ids = [
            _cluster_id_for_node(arrays.node_ids[child_index])
            for child_index in arrays.child_indices[node_index]
        ]

        clusters[_cluster_id_for_node(node_id)] = HierarchyCluster(
            cluster_id=_cluster_id_for_node(node_id),
            parent_cluster_id=parent_cluster_id,
            child_cluster_ids=child_cluster_ids,
            representative_node_id=node_id,
            preorder_index=preorder_index[node_index],
            postorder_index=postorder_index[node_index],
            subtree_size=subtree_size[node_index],
            leaf_count=leaf_count[node_index],
            depth=arrays.depth[node_index],
            min_depth=arrays.depth[node_index],
            max_depth=max_depth[node_index],
            centroid={
                "x": x_by_index[node_index],
                "y": float(arrays.depth[node_index]),
            },
            bounds={
                "min_x": min_x[node_index],
                "max_x": max_x[node_index],
                "min_y": float(arrays.depth[node_index]),
                "max_y": float(max_depth[node_index]),
            },
        )

    return clusters


def _is_existing_orientation_rooted_tree(
    dataset: CanonicalDataset,
    index_by_node_id: dict[str, int],
) -> bool:
    node_count = len(dataset.nodes)
    incoming_count = [0] * node_count
    child_indices = [[] for _ in range(node_count)]

    for edge in dataset.edges:
        source_index = index_by_node_id[edge.source]
        target_index = index_by_node_id[edge.target]
        incoming_count[target_index] += 1
        if incoming_count[target_index] > 1:
            return False
        child_indices[source_index].append(target_index)

    root_indices = [index for index, count in enumerate(incoming_count) if count == 0]
    if len(root_indices) != 1:
        return False

    visited = [False] * node_count
    stack = [root_indices[0]]
    while stack:
        node_index = stack.pop()
        if visited[node_index]:
            return False
        visited[node_index] = True
        for child_index in child_indices[node_index]:
            stack.append(child_index)

    return all(visited)


def _assert_connected(adjacency: list[list[int]]) -> None:
    visited = [False] * len(adjacency)
    stack = [0]
    visited[0] = True

    while stack:
        node_index = stack.pop()
        for neighbor_index in adjacency[node_index]:
            if visited[neighbor_index]:
                continue
            visited[neighbor_index] = True
            stack.append(neighbor_index)

    if not all(visited):
        raise HierarchyBuildError(ERR_HIERARCHY_DISCONNECTED)


def _select_tree_center_root(node_ids: list[str], adjacency: list[list[int]]) -> int:
    node_count = len(node_ids)
    if node_count == 1:
        return 0

    degree = [len(neighbors) for neighbors in adjacency]
    leaves = deque(index for index, current_degree in enumerate(degree) if current_degree <= 1)
    remaining = node_count

    while remaining > 2:
        layer_size = len(leaves)
        remaining -= layer_size
        for _ in range(layer_size):
            leaf_index = leaves.popleft()
            degree[leaf_index] = 0
            for neighbor_index in adjacency[leaf_index]:
                if degree[neighbor_index] == 0:
                    continue
                degree[neighbor_index] -= 1
                if degree[neighbor_index] == 1:
                    leaves.append(neighbor_index)

    centers = list(leaves) if leaves else [0]
    return min(centers, key=node_ids.__getitem__)


def _normalized_pair(left: int, right: int) -> tuple[int, int]:
    return (left, right) if left < right else (right, left)


def _cluster_id_for_node(node_id: str) -> str:
    return f"{CLUSTER_ID_PREFIX}_{node_id}"
