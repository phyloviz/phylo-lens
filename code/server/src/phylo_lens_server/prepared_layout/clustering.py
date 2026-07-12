from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from hashlib import sha1
from math import hypot, sqrt

from phylo_lens_server.core.models import (
    CanonicalDataset,
    CanonicalEdge,
    CanonicalNode,
)
from phylo_lens_server.prepared_layout.models import (
    PreparedCluster,
)

MAX_CLUSTER_THRESHOLDS = 16
MIN_OVERVIEW_REPRESENTATIVES = 300
MAX_OVERVIEW_REPRESENTATIVES = 800
SMALL_GRAPH_OVERVIEW_FACTOR = 7
LOD_REPRESENTATIVE_GROWTH_FACTOR = 2.5
CLUSTER_ID_PREFIX = "distance_cluster"


def _edge_distance(edge: CanonicalEdge) -> float:
    return 0.0 if edge.distance is None else edge.distance


@dataclass(frozen=True)
class ClusterIndex:
    node_by_id: dict[str, CanonicalNode]
    incident_by_node: dict[str, list[tuple[int, str, str]]]

    @classmethod
    def build(cls, dataset: CanonicalDataset) -> ClusterIndex:
        node_by_id = {node.id: node for node in dataset.nodes}
        incident_by_node: dict[str, list[tuple[int, str, str]]] = defaultdict(list)
        for position, edge in enumerate(dataset.edges):
            incident_by_node[edge.source].append((position, edge.id, edge.target))
            incident_by_node[edge.target].append((position, edge.id, edge.source))
        return cls(node_by_id=node_by_id, incident_by_node=incident_by_node)


@dataclass
class _UnionFind:
    parent: list[int]
    size: list[int]

    @classmethod
    def create(cls, size: int) -> _UnionFind:
        return cls(parent=list(range(size)), size=[1] * size)

    def find(self, index: int) -> int:
        while index != self.parent[index]:
            self.parent[index] = self.parent[self.parent[index]]
            index = self.parent[index]
        return index

    def union(self, left: int, right: int) -> None:
        left_root = self.find(left)
        right_root = self.find(right)
        if left_root == right_root:
            return
        if self.size[left_root] < self.size[right_root]:
            left_root, right_root = right_root, left_root
        self.parent[right_root] = left_root
        self.size[left_root] += self.size[right_root]


@dataclass(frozen=True)
class _ThresholdComponentCount:
    threshold: float
    component_count: int


def representative_targets(node_count: int, max_thresholds: int) -> tuple[int, ...]:
    if node_count <= 0 or max_thresholds <= 0:
        return ()
    if node_count <= MIN_OVERVIEW_REPRESENTATIVES:
        overview = min(
            node_count, max(2, round(sqrt(node_count) * SMALL_GRAPH_OVERVIEW_FACTOR))
        )
    else:
        overview = min(
            node_count,
            max(
                MIN_OVERVIEW_REPRESENTATIVES,
                min(
                    MAX_OVERVIEW_REPRESENTATIVES,
                    round(sqrt(node_count) * SMALL_GRAPH_OVERVIEW_FACTOR),
                ),
            ),
        )

    targets = [overview]
    current = overview
    while current < node_count and len(targets) < max_thresholds - 1:
        smooth_growth = round(sqrt(current * node_count))
        capped_growth = round(current * LOD_REPRESENTATIVE_GROWTH_FACTOR)
        next_target = min(
            node_count,
            max(current + 1, min(smooth_growth, capped_growth)),
        )
        if next_target >= node_count:
            break
        targets.append(next_target)
        current = next_target
    if targets[-1] != node_count:
        targets.append(node_count)

    return tuple(dict.fromkeys(targets[:max_thresholds]))


def threshold_component_counts(
    node_ids: tuple[str, ...],
    edges: list[CanonicalEdge],
    thresholds_desc: tuple[float, ...],
) -> tuple[_ThresholdComponentCount, ...]:
    node_index_by_id = {node_id: index for index, node_id in enumerate(node_ids)}
    weighted_edges = sorted(
        ((_edge_distance(edge), edge.source, edge.target) for edge in edges),
        key=lambda item: (item[0], item[1], item[2]),
    )
    union_find = _UnionFind.create(len(node_ids))
    edge_index = 0
    counts_by_threshold: dict[float, int] = {}

    for threshold in reversed(thresholds_desc):
        while edge_index < len(weighted_edges):
            distance, source, target = weighted_edges[edge_index]
            if distance > threshold:
                break
            union_find.union(node_index_by_id[source], node_index_by_id[target])
            edge_index += 1
        roots = {union_find.find(index) for index in range(len(node_ids))}
        counts_by_threshold[threshold] = len(roots)

    return tuple(
        _ThresholdComponentCount(
            threshold=threshold,
            component_count=counts_by_threshold[threshold],
        )
        for threshold in thresholds_desc
    )


def threshold_for_representative_target(
    component_counts: tuple[_ThresholdComponentCount, ...],
    target: int,
) -> float:
    candidates = [
        count for count in component_counts if count.component_count >= target
    ]
    if candidates:
        return min(
            candidates,
            key=lambda count: (
                count.component_count - target,
                count.threshold,
            ),
        ).threshold
    return max(component_counts, key=lambda count: count.component_count).threshold


def sort_edges_by_distance(edges: list[CanonicalEdge]) -> tuple[CanonicalEdge, ...]:
    return tuple(sorted(edges, key=lambda edge: (_edge_distance(edge), edge.id)))


def components_for_union_find(
    node_ids: tuple[str, ...],
    union_find: _UnionFind,
) -> tuple[tuple[str, ...], ...]:
    members_by_root: dict[int, list[str]] = defaultdict(list)
    for index, node_id in enumerate(node_ids):
        members_by_root[union_find.find(index)].append(node_id)
    return tuple(
        sorted(
            (tuple(sorted(members)) for members in members_by_root.values()),
            key=lambda component: (component[0], len(component)),
        )
    )


def cluster_id_for_component(threshold: float, member_node_ids: tuple[str, ...]) -> str:
    digest = sha1(",".join(member_node_ids).encode("utf-8")).hexdigest()[:10]
    return f"{CLUSTER_ID_PREFIX}_{threshold:g}_{member_node_ids[0]}_{digest}"


def partition_for_threshold(
    dataset: CanonicalDataset,
    node_ids: tuple[str, ...],
    threshold: float,
    *,
    sorted_edges: tuple[CanonicalEdge, ...] | None = None,
) -> dict[str, str]:
    node_index_by_id = {node_id: index for index, node_id in enumerate(node_ids)}
    union_find = _UnionFind.create(len(node_ids))
    if sorted_edges is None:
        sorted_edges = sort_edges_by_distance(dataset.edges)
    for edge in sorted_edges:
        if _edge_distance(edge) <= threshold:
            union_find.union(
                node_index_by_id[edge.source],
                node_index_by_id[edge.target],
            )

    partition: dict[str, str] = {}
    for component in components_for_union_find(node_ids, union_find):
        cluster_id = cluster_id_for_component(threshold, component)
        for node_id in component:
            partition[node_id] = cluster_id
    return partition


def prepared_cluster(
    dataset: CanonicalDataset,
    threshold: float,
    member_node_ids: tuple[str, ...],
    *,
    index: ClusterIndex | None = None,
) -> PreparedCluster:
    cluster_index = index if index is not None else ClusterIndex.build(dataset)
    member_set = set(member_node_ids)
    internal_by_position: dict[int, str] = {}
    boundary_by_position: dict[int, str] = {}
    internal_degree: dict[str, int] = {node_id: 0 for node_id in member_node_ids}
    for member in member_node_ids:
        for position, edge_id, other_end in cluster_index.incident_by_node.get(
            member, ()
        ):
            if other_end in member_set:
                if position not in internal_by_position:
                    internal_by_position[position] = edge_id
                    internal_degree[member] += 1
                    internal_degree[other_end] += 1
            else:
                boundary_by_position[position] = edge_id
    internal_edges = tuple(
        internal_by_position[position] for position in sorted(internal_by_position)
    )
    boundary_edges = tuple(
        boundary_by_position[position] for position in sorted(boundary_by_position)
    )
    return PreparedCluster(
        cluster_id=cluster_id_for_component(threshold, member_node_ids),
        threshold=threshold,
        member_node_ids=member_node_ids,
        representative_node_id=representative_by_centroid(
            dataset,
            member_node_ids,
            node_by_id=cluster_index.node_by_id,
            internal_degree=internal_degree,
        ),
        internal_edge_ids=internal_edges,
        boundary_edge_ids=boundary_edges,
    )


def representative_by_centroid(
    dataset: CanonicalDataset,
    member_node_ids: tuple[str, ...],
    *,
    node_by_id: dict[str, CanonicalNode] | None = None,
    internal_degree: dict[str, int] | None = None,
) -> str:
    member_set = set(member_node_ids)
    if node_by_id is None:
        node_lookup = {node.id: node for node in dataset.nodes}
    else:
        node_lookup = node_by_id
    nodes = {
        node_id: node_lookup[node_id]
        for node_id in member_node_ids
        if node_id in node_lookup
    }
    if internal_degree is None:
        internal_degree = {node_id: 0 for node_id in member_node_ids}
        for edge in dataset.edges:
            if edge.source in member_set and edge.target in member_set:
                internal_degree[edge.source] += 1
                internal_degree[edge.target] += 1

    positioned = [
        node for node in nodes.values() if node.x is not None and node.y is not None
    ]
    if positioned:
        center_x = sum(node.x or 0.0 for node in positioned) / len(positioned)
        center_y = sum(node.y or 0.0 for node in positioned) / len(positioned)
        return min(
            member_node_ids,
            key=lambda node_id: (
                hypot(
                    (nodes[node_id].x or 0.0) - center_x,
                    (nodes[node_id].y or 0.0) - center_y,
                ),
                -internal_degree[node_id],
                node_id,
            ),
        )

    return min(
        member_node_ids,
        key=lambda node_id: (-internal_degree[node_id], node_id),
    )


def distance_clusters(
    dataset: CanonicalDataset,
    node_ids: tuple[str, ...],
    thresholds_desc: tuple[float, ...],
    *,
    index: ClusterIndex | None = None,
) -> list[PreparedCluster]:
    node_index_by_id = {node_id: index_ for index_, node_id in enumerate(node_ids)}
    cluster_index = index if index is not None else ClusterIndex.build(dataset)
    weighted_edges = sorted(
        ((_edge_distance(edge), edge.source, edge.target) for edge in dataset.edges),
        key=lambda item: (item[0], item[1], item[2]),
    )
    thresholds_asc = tuple(reversed(thresholds_desc))
    union_find = _UnionFind.create(len(node_ids))
    edge_index = 0
    clusters_by_key: dict[tuple[str, ...], PreparedCluster] = {}

    for threshold in thresholds_asc:
        while edge_index < len(weighted_edges):
            distance, source, target = weighted_edges[edge_index]
            if distance > threshold:
                break
            union_find.union(node_index_by_id[source], node_index_by_id[target])
            edge_index += 1

        for component in components_for_union_find(node_ids, union_find):
            if len(component) <= 1 or component in clusters_by_key:
                continue
            clusters_by_key[component] = prepared_cluster(
                dataset, threshold, component, index=cluster_index
            )

    return sorted(
        clusters_by_key.values(),
        key=lambda cluster: (
            -cluster.member_count,
            cluster.threshold or 0.0,
            cluster.cluster_id,
        ),
    )
