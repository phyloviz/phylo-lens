from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from hashlib import sha1
from math import hypot, sqrt

from phylo_lens_server.core.models import CanonicalDataset, CanonicalEdge
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
    thresholds = selected_distance_thresholds(node_ids, dataset.edges, max_thresholds)
    clusters = distance_clusters(dataset, node_ids, thresholds)
    clusters_by_id = {cluster.cluster_id: cluster for cluster in clusters}
    sorted_edges = sort_edges_by_distance(dataset.edges)
    for threshold in thresholds:
        partition = partition_for_threshold(
            dataset, node_ids, threshold, sorted_edges=sorted_edges
        )
        for cluster_id in sorted(set(partition.values())):
            if cluster_id in clusters_by_id:
                continue
            member_node_ids = tuple(
                node_id
                for node_id, node_cluster_id in partition.items()
                if node_cluster_id == cluster_id
            )
            clusters_by_id[cluster_id] = prepared_cluster(
                dataset,
                threshold,
                member_node_ids,
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
) -> list[PreparedCluster]:
    node_index_by_id = {node_id: index for index, node_id in enumerate(node_ids)}
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
            clusters_by_key[component] = prepared_cluster(dataset, threshold, component)

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
) -> PreparedCluster:
    member_set = set(member_node_ids)
    internal_edges = tuple(
        edge.id
        for edge in dataset.edges
        if edge.source in member_set and edge.target in member_set
    )
    boundary_edges = tuple(
        edge.id
        for edge in dataset.edges
        if (edge.source in member_set) != (edge.target in member_set)
    )
    return PreparedCluster(
        cluster_id=cluster_id_for_component(threshold, member_node_ids),
        threshold=threshold,
        member_node_ids=member_node_ids,
        representative_node_id=representative_by_centroid(dataset, member_node_ids),
        internal_edge_ids=internal_edges,
        boundary_edge_ids=boundary_edges,
    )


def representative_by_centroid(
    dataset: CanonicalDataset,
    member_node_ids: tuple[str, ...],
) -> str:
    """Pick the member that stands in for its cluster at coarser tiers.

    This is a layout-centroid heuristic, not a distance medoid: when members are
    already positioned, it returns the member closest to the cluster's spatial
    centroid (tie-broken by higher internal degree, then id) so the proxy sits
    visually in the middle of its cluster. Before positions exist, it falls back
    to the most internally connected member. It intentionally does not minimize
    summed genetic distance, so it is named for what it computes.
    """
    member_set = set(member_node_ids)
    nodes = {node.id: node for node in dataset.nodes if node.id in member_set}
    internal_degree: dict[str, int] = {node_id: 0 for node_id in member_node_ids}
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
