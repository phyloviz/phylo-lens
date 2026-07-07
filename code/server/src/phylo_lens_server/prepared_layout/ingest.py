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
    PreparedLayoutArtifacts,
)

# Upper bound on the number of distance thresholds (LoD tiers) we precompute per
# dataset. Each threshold is a full connected-components pass, so this caps
# ingest cost and the on-disk tier count; 16 spans overview→finest with room to
# spare for the target progression below.
MAX_CLUSTER_THRESHOLDS = 16
# Floor for the coarsest ("overview") tier's representative count. Below this the
# overview would collapse too much of the tree to stay legible on first paint, so
# small graphs are floored here (bounded by their own node count).
MIN_OVERVIEW_REPRESENTATIVES = 300
# Ceiling for the overview representative count. Past ~800 nodes the initial
# force layout stops reading as an overview and starts costing real render time,
# so larger graphs are capped here regardless of node count.
MAX_OVERVIEW_REPRESENTATIVES = 800
# Overview size grows with sqrt(node_count) (area-proportional detail, not
# linear) scaled by this factor. 7 places a 10k-node tree near the 700 mark,
# comfortably inside the [300, 800] band above.
SMALL_GRAPH_OVERVIEW_FACTOR = 7
CLUSTER_ID_PREFIX = "distance_cluster"

ERR_EMPTY_DATASET = "Prepared layout requires at least one node."
ERR_MISSING_DISTANCE = "Prepared layout requires every edge to carry a distance value."


def _edge_distance(edge: CanonicalEdge) -> float:
    """Return an edge's distance, treating only a truly missing value as 0.0.

    ``prepare_layout_artifacts`` rejects ``None`` distances up front, so the
    fallback is defensive; the explicit ``is None`` check is what preserves a
    genuine ``distance == 0.0`` (indistinguishable nodes) instead of coercing it
    away like a truthiness test would.
    """
    return 0.0 if edge.distance is None else edge.distance


class PreparedLayoutIngestError(ValueError):
    """Raised when a dataset cannot be prepared for materialized layout."""


@dataclass(frozen=True)
class _ClusterIndex:
    """Precomputed lookups so per-cluster work scales with cluster size.

    Building ``prepared_cluster`` for thousands of components previously rescanned
    every node and edge per cluster (O(clusters * (nodes + edges))). These indexes
    are built once so each cluster only touches edges incident to its own members,
    while preserving the original ``dataset.edges`` ordering of emitted edge ids.
    """

    node_by_id: dict[str, CanonicalNode]
    # For each node id, the incident edges as (edge_position, edge_id, other_end).
    # ``edge_position`` is the index into ``dataset.edges`` so callers can restore
    # the original edge ordering after gathering a cluster's incident edges.
    incident_by_node: dict[str, list[tuple[int, str, str]]]

    @classmethod
    def build(cls, dataset: CanonicalDataset) -> _ClusterIndex:
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


def prepare_layout_artifacts(
    dataset: CanonicalDataset,
    *,
    max_thresholds: int = MAX_CLUSTER_THRESHOLDS,
) -> PreparedLayoutArtifacts:
    """Build distance-based cluster artifacts without doing request-time layout."""
    if not dataset.nodes:
        raise PreparedLayoutIngestError(ERR_EMPTY_DATASET)
    if any(edge.distance is None for edge in dataset.edges):
        raise PreparedLayoutIngestError(ERR_MISSING_DISTANCE)

    node_ids = tuple(sorted(node.id for node in dataset.nodes))
    index = _ClusterIndex.build(dataset)
    thresholds = selected_distance_thresholds(node_ids, dataset.edges, max_thresholds)
    clusters = distance_clusters(dataset, node_ids, thresholds, index=index)
    clusters_by_id = {cluster.cluster_id: cluster for cluster in clusters}
    sorted_edges = sort_edges_by_distance(dataset.edges)
    for threshold in thresholds:
        partition = partition_for_threshold(
            dataset, node_ids, threshold, sorted_edges=sorted_edges
        )
        # Group members by cluster id in a single pass so each cluster is built
        # from its own members rather than re-filtering the full partition per id.
        members_by_cluster_id: dict[str, list[str]] = defaultdict(list)
        for node_id, node_cluster_id in partition.items():
            members_by_cluster_id[node_cluster_id].append(node_id)
        for cluster_id in sorted(members_by_cluster_id):
            if cluster_id in clusters_by_id:
                continue
            member_node_ids = tuple(members_by_cluster_id[cluster_id])
            clusters_by_id[cluster_id] = prepared_cluster(
                dataset,
                threshold,
                member_node_ids,
                index=index,
            )
    clusters = sorted(
        clusters_by_id.values(),
        key=lambda cluster: (
            -cluster.member_count,
            cluster.threshold or 0.0,
            cluster.cluster_id,
        ),
    )
    return PreparedLayoutArtifacts(
        dataset=dataset,
        layout_version=layout_version_for_dataset(dataset),
        clusters=tuple(clusters),
    )


def selected_distance_thresholds(
    node_ids: tuple[str, ...],
    edges: list[CanonicalEdge],
    max_thresholds: int,
) -> tuple[float, ...]:
    unique_desc = sorted(
        {edge.distance for edge in edges if edge.distance is not None},
        reverse=True,
    )
    if not unique_desc:
        return (0.0,)
    if len(node_ids) <= 1:
        return (unique_desc[-1],)

    component_counts = threshold_component_counts(node_ids, edges, tuple(unique_desc))
    selected: list[float] = []
    for target in representative_targets(len(node_ids), max_thresholds):
        threshold = threshold_for_representative_target(component_counts, target)
        if threshold not in selected:
            selected.append(threshold)

    finest_threshold = unique_desc[-1]
    if finest_threshold not in selected:
        selected.append(finest_threshold)

    return tuple(sorted(selected[:max_thresholds], reverse=True))


def representative_targets(node_count: int, max_thresholds: int) -> tuple[int, ...]:
    """Representative counts for the LoD tiers, coarse→fine.

    Produces up to three anchor tiers — overview, a geometric-mean "medium", and
    the full graph — then de-duplicates. The medium tier sits at the geometric
    mean of overview and node_count so the jump from overview to full detail is
    split evenly on a log scale (one zoom step never dumps the whole tree at
    once). Empty when there is nothing to represent.
    """
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

    medium = min(node_count, max(overview, round(sqrt(overview * node_count))))
    targets = [overview]
    if medium > overview:
        targets.append(medium)
    if node_count > medium:
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


def distance_clusters(
    dataset: CanonicalDataset,
    node_ids: tuple[str, ...],
    thresholds_desc: tuple[float, ...],
    *,
    index: _ClusterIndex | None = None,
) -> list[PreparedCluster]:
    node_index_by_id = {node_id: index_ for index_, node_id in enumerate(node_ids)}
    cluster_index = index if index is not None else _ClusterIndex.build(dataset)
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


def sort_edges_by_distance(
    edges: list[CanonicalEdge],
) -> tuple[CanonicalEdge, ...]:
    """Order edges by ``(distance, id)`` once for reuse across thresholds."""
    return tuple(sorted(edges, key=lambda edge: (_edge_distance(edge), edge.id)))


def partition_for_threshold(
    dataset: CanonicalDataset,
    node_ids: tuple[str, ...],
    threshold: float,
    *,
    sorted_edges: tuple[CanonicalEdge, ...] | None = None,
) -> dict[str, str]:
    node_index_by_id = {node_id: index for index, node_id in enumerate(node_ids)}
    union_find = _UnionFind.create(len(node_ids))
    # Connected components are independent of union order, so a caller iterating
    # many thresholds can sort once (see ``sort_edges_by_distance``) and pass the
    # result in to avoid re-sorting the full edge list per threshold.
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


def prepared_cluster(
    dataset: CanonicalDataset,
    threshold: float,
    member_node_ids: tuple[str, ...],
    *,
    index: _ClusterIndex | None = None,
) -> PreparedCluster:
    cluster_index = index if index is not None else _ClusterIndex.build(dataset)
    member_set = set(member_node_ids)
    # Gather only edges incident to this cluster's members, then restore the
    # original ``dataset.edges`` order via the recorded edge position. An internal
    # edge is seen from both endpoints, so it is deduplicated by position; a
    # boundary edge is seen from exactly one member. This preserves the previous
    # full-scan output while touching O(cluster incident edges) instead of O(E).
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
    """Pick the member that stands in for its cluster at coarser tiers.

    This is a layout-centroid heuristic, not a distance medoid: when members are
    already positioned, it returns the member closest to the cluster's spatial
    centroid (tie-broken by higher internal degree, then id) so the proxy sits
    visually in the middle of its cluster. Before positions exist, it falls back
    to the most internally connected member. It intentionally does not minimize
    summed genetic distance, so it is named for what it computes.

    ``node_by_id`` and ``internal_degree`` may be supplied by the caller to avoid
    rescanning the full node and edge lists per cluster; when omitted they are
    derived here so direct callers keep the original behaviour.
    """
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


def cluster_id_for_component(threshold: float, member_node_ids: tuple[str, ...]) -> str:
    digest = sha1(",".join(member_node_ids).encode("utf-8")).hexdigest()[:10]
    return f"{CLUSTER_ID_PREFIX}_{threshold:g}_{member_node_ids[0]}_{digest}"


def layout_version_for_dataset(dataset: CanonicalDataset) -> str:
    payload = "|".join(
        [
            dataset.dataset_id,
            ",".join(sorted(node.id for node in dataset.nodes)),
            ",".join(
                f"{edge.source}>{edge.target}:{edge.distance}"
                for edge in sorted(dataset.edges, key=lambda edge: edge.id)
            ),
        ]
    )
    return sha1(payload.encode("utf-8")).hexdigest()[:16]
