from __future__ import annotations

from dataclasses import dataclass
import time

from phylo_lens_server.clustering.spatial import (
    global_bounds_from_top_clusters,
    spatial_bounds_from_cluster_bounds,
)
from phylo_lens_server.clustering.spatial_index import build_str_spatial_index
from phylo_lens_server.core.models import (
    CanonicalDataset,
    SpatialBounds,
    SpatialLevelIndex,
    ThresholdHierarchyCluster,
    ThresholdHierarchyIndex,
)

THRESHOLD_CLUSTER_ID_PREFIX = "threshold_cluster"
MAX_THRESHOLD_LEVELS = 16

ERR_THRESHOLD_EMPTY = "Cannot build threshold hierarchy from an empty dataset."
ERR_THRESHOLD_MISSING_DISTANCE = (
    "Threshold hierarchy requires every edge to carry a distance value."
)
ERR_THRESHOLD_MISSING_POSITION = (
    "Threshold hierarchy requires prepared node positions. "
    "Run global layout before building the hierarchy."
)


class ThresholdHierarchyBuildError(ValueError):
    """Raised when a weighted dataset cannot be converted into threshold hierarchy."""


@dataclass(frozen=True)
class _ComponentLevel:
    level: int
    distance_threshold: float | None
    components: list[tuple[str, ...]]


@dataclass(frozen=True)
class ThresholdHierarchyBuildStats:
    topology_ms: float
    thresholds_ms: float
    components_ms: float
    layout_ms: float
    cluster_ms: float
    geometry_ms: float
    spatial_index_ms: float


class _UnionFind:
    """Array-backed Union-Find with path halving and union by size."""

    def __init__(self, size: int) -> None:
        self.parent = list(range(size))
        self.size = [1] * size
        self.components = size

    def find(self, node_index: int) -> int:
        parent = self.parent
        while node_index != parent[node_index]:
            parent[node_index] = parent[parent[node_index]]
            node_index = parent[node_index]
        return node_index

    def union(self, left_index: int, right_index: int) -> bool:
        root_left = self.find(left_index)
        root_right = self.find(right_index)
        if root_left == root_right:
            return False

        if self.size[root_left] < self.size[root_right]:
            root_left, root_right = root_right, root_left

        self.parent[root_right] = root_left
        self.size[root_left] += self.size[root_right]
        self.components -= 1
        return True


def build_threshold_hierarchy(
    dataset: CanonicalDataset,
) -> tuple[ThresholdHierarchyIndex, ThresholdHierarchyBuildStats]:
    """Build a threshold hierarchy and return phase timings for prepare profiling."""
    topology_start = time.perf_counter()
    node_ids, weighted_edges = _validated_weighted_topology(dataset)
    topology_ms = _elapsed_ms(topology_start)

    thresholds_start = time.perf_counter()
    thresholds = _selected_thresholds(weighted_edges)
    thresholds_ms = _elapsed_ms(thresholds_start)

    components_start = time.perf_counter()
    levels = _build_component_levels(node_ids, weighted_edges, thresholds)
    components_ms = _elapsed_ms(components_start)

    node_positions = _node_positions_from_dataset(dataset)

    cluster_start = time.perf_counter()
    clusters, cluster_id_by_level_and_component, nodes_by_level = (
        _build_threshold_clusters(levels)
    )
    _link_threshold_clusters(clusters, nodes_by_level)

    top_cluster_ids = _resolve_top_cluster_ids(
        levels,
        cluster_id_by_level_and_component,
    )
    _choose_threshold_representatives(
        clusters,
        levels,
        cluster_id_by_level_and_component,
    )
    top_cluster_ids = _collapse_redundant_threshold_clusters(
        clusters,
        top_cluster_ids,
    )
    cluster_ms = _elapsed_ms(cluster_start)

    geometry_start = time.perf_counter()
    _assign_cluster_geometry(clusters, node_positions)
    geometry_ms = _elapsed_ms(geometry_start)

    spatial_index_start = time.perf_counter()
    spatial_index_by_level = _spatial_index_by_level(clusters)
    spatial_index_ms = _elapsed_ms(spatial_index_start)

    hierarchy = ThresholdHierarchyIndex(
        dataset_id=dataset.dataset_id,
        top_cluster_ids=top_cluster_ids,
        clusters=clusters,
        global_bounds=global_bounds_from_top_clusters(clusters, top_cluster_ids),
        max_distance_threshold_level=_max_distance_threshold_level(clusters),
        cluster_ids_by_level=_cluster_ids_by_level(clusters),
        spatial_index_by_level=spatial_index_by_level,
    )
    return hierarchy, ThresholdHierarchyBuildStats(
        topology_ms=round(topology_ms, 3),
        thresholds_ms=round(thresholds_ms, 3),
        components_ms=round(components_ms, 3),
        layout_ms=0.0,
        cluster_ms=round(cluster_ms, 3),
        geometry_ms=round(geometry_ms, 3),
        spatial_index_ms=round(spatial_index_ms, 3),
    )


def _elapsed_ms(start_time: float) -> float:
    return (time.perf_counter() - start_time) * 1000


def _validated_weighted_topology(
    dataset: CanonicalDataset,
) -> tuple[list[str], list[tuple[float, int, int]]]:
    if not dataset.nodes:
        raise ThresholdHierarchyBuildError(ERR_THRESHOLD_EMPTY)
    if any(edge.distance is None for edge in dataset.edges):
        raise ThresholdHierarchyBuildError(ERR_THRESHOLD_MISSING_DISTANCE)

    node_ids = sorted(node.id for node in dataset.nodes)
    node_index_by_id = {node_id: index for index, node_id in enumerate(node_ids)}
    weighted_edges = sorted(
        (
            (
                edge.distance or 0.0,
                node_index_by_id[edge.source],
                node_index_by_id[edge.target],
            )
            for edge in dataset.edges
        ),
        key=lambda item: (item[0], item[1], item[2]),
    )
    return node_ids, weighted_edges


def _build_threshold_clusters(
    levels: list[_ComponentLevel],
) -> tuple[
    dict[str, ThresholdHierarchyCluster],
    dict[tuple[int, tuple[str, ...]], str],
    list[dict[str, str]],
]:
    clusters: dict[str, ThresholdHierarchyCluster] = {}
    cluster_id_by_level_and_component: dict[tuple[int, tuple[str, ...]], str] = {}
    nodes_by_level: list[dict[str, str]] = []
    active_cluster_id_by_component: dict[tuple[str, ...], str] = {}

    for level in levels:
        node_to_cluster_id: dict[str, str] = {}
        next_active_cluster_id_by_component: dict[tuple[str, ...], str] = {}
        for component in level.components:
            cluster_id = active_cluster_id_by_component.get(component)
            if cluster_id is None:
                cluster_id = _cluster_id_for_component(level.level, component[0])
                clusters[cluster_id] = ThresholdHierarchyCluster(
                    cluster_id=cluster_id,
                    representative_node_id=component[0],
                    member_node_ids=list(component),
                    subtree_size=len(component),
                    distance_threshold_level=level.level,
                    distance_threshold=level.distance_threshold,
                )

            cluster_id_by_level_and_component[(level.level, component)] = cluster_id
            next_active_cluster_id_by_component[component] = cluster_id
            for node_id in component:
                node_to_cluster_id[node_id] = cluster_id
        nodes_by_level.append(node_to_cluster_id)
        active_cluster_id_by_component = next_active_cluster_id_by_component

    return clusters, cluster_id_by_level_and_component, nodes_by_level


def _link_threshold_clusters(
    clusters: dict[str, ThresholdHierarchyCluster],
    nodes_by_level: list[dict[str, str]],
) -> None:
    for level_index, node_to_cluster_id in enumerate(nodes_by_level[:-1]):
        finer_node_to_cluster_id = nodes_by_level[level_index + 1]
        parent_to_children: dict[str, set[str]] = {}
        child_to_parent: dict[str, str] = {}

        for node_id, parent_cluster_id in node_to_cluster_id.items():
            child_cluster_id = finer_node_to_cluster_id[node_id]
            if child_cluster_id == parent_cluster_id:
                continue
            parent_to_children.setdefault(parent_cluster_id, set()).add(
                child_cluster_id
            )
            child_to_parent[child_cluster_id] = parent_cluster_id

        for parent_cluster_id, child_cluster_ids in parent_to_children.items():
            clusters[parent_cluster_id].child_cluster_ids = sorted(child_cluster_ids)
        for child_cluster_id, parent_cluster_id in child_to_parent.items():
            clusters[child_cluster_id].parent_cluster_id = parent_cluster_id


def _choose_threshold_representatives(
    clusters: dict[str, ThresholdHierarchyCluster],
    levels: list[_ComponentLevel],
    cluster_id_by_level_and_component: dict[tuple[int, tuple[str, ...]], str],
) -> None:
    visited_cluster_ids: set[str] = set()
    for level in reversed(levels):
        for component in level.components:
            cluster_id = cluster_id_by_level_and_component[(level.level, component)]
            if cluster_id in visited_cluster_ids:
                continue
            visited_cluster_ids.add(cluster_id)
            child_representatives = {
                clusters[child_cluster_id].representative_node_id
                for child_cluster_id in clusters[cluster_id].child_cluster_ids
                if clusters[child_cluster_id].representative_node_id is not None
            }
            representative_node_id = clusters[cluster_id].member_node_ids[0]
            for node_id in clusters[cluster_id].member_node_ids:
                if node_id not in child_representatives:
                    representative_node_id = node_id
                    break
            clusters[cluster_id].representative_node_id = representative_node_id


def _resolve_top_cluster_ids(
    levels: list[_ComponentLevel],
    cluster_id_by_level_and_component: dict[tuple[int, tuple[str, ...]], str],
) -> list[str]:
    top_level = levels[0]
    return [
        cluster_id_by_level_and_component[(top_level.level, component)]
        for component in top_level.components
    ]


def _selected_thresholds(
    weighted_edges: list[tuple[float, int, int]],
) -> list[float]:
    unique_thresholds_desc = sorted(
        {distance for distance, _, _ in weighted_edges},
        reverse=True,
    )
    if len(unique_thresholds_desc) <= MAX_THRESHOLD_LEVELS - 1:
        return unique_thresholds_desc

    sampled: list[float] = []
    last_value: float | None = None
    for slot in range(MAX_THRESHOLD_LEVELS - 1):
        index = round(
            slot * (len(unique_thresholds_desc) - 1) / (MAX_THRESHOLD_LEVELS - 2)
        )
        value = unique_thresholds_desc[index]
        if value == last_value:
            continue
        sampled.append(value)
        last_value = value

    return sampled


def _build_component_levels(
    node_ids: list[str],
    weighted_edges: list[tuple[float, int, int]],
    thresholds_desc: list[float],
) -> list[_ComponentLevel]:
    thresholds_asc = list(reversed(thresholds_desc))
    union_find = _UnionFind(len(node_ids))
    components_by_threshold: list[list[tuple[str, ...]]] = []
    edge_index = 0

    for threshold in thresholds_asc:
        while edge_index < len(weighted_edges):
            distance, source_index, target_index = weighted_edges[edge_index]
            if distance > threshold:
                break
            union_find.union(source_index, target_index)
            edge_index += 1
        components_by_threshold.append(_sorted_components(node_ids, union_find))

    levels = [
        _ComponentLevel(
            level=level_index,
            distance_threshold=threshold,
            components=components,
        )
        for level_index, (threshold, components) in enumerate(
            zip(thresholds_desc, reversed(components_by_threshold), strict=True)
        )
    ]

    singleton_level = _ComponentLevel(
        level=len(levels),
        distance_threshold=None,
        components=[(node_id,) for node_id in node_ids],
    )
    levels.append(singleton_level)
    return levels


def _sorted_components(
    node_ids: list[str],
    union_find: _UnionFind,
) -> list[tuple[str, ...]]:
    components: dict[int, list[str]] = {}
    for node_index, node_id in enumerate(node_ids):
        components.setdefault(union_find.find(node_index), []).append(node_id)

    normalized = [tuple(member_ids) for member_ids in components.values()]
    return sorted(normalized, key=lambda component: (component[0], len(component)))


def _cluster_id_for_component(level: int, representative_node_id: str) -> str:
    return f"{THRESHOLD_CLUSTER_ID_PREFIX}_{level}_{representative_node_id}"


def _collapse_redundant_threshold_clusters(
    clusters: dict[str, ThresholdHierarchyCluster],
    top_cluster_ids: list[str],
) -> list[str]:
    reachable_cluster_ids: set[str] = set()
    redundant_cluster_ids: set[str] = set()

    def collapse(cluster_id: str) -> str:
        cluster = clusters[cluster_id]

        collapsed_child_ids = [
            collapse(child_id) for child_id in cluster.child_cluster_ids
        ]
        cluster.child_cluster_ids = collapsed_child_ids

        for child_cluster_id in collapsed_child_ids:
            clusters[child_cluster_id].parent_cluster_id = cluster_id

        while len(cluster.child_cluster_ids) == 1:
            child_cluster_id = cluster.child_cluster_ids[0]
            child_cluster = clusters[child_cluster_id]

            if child_cluster.member_node_ids != cluster.member_node_ids:
                break

            redundant_cluster_ids.add(child_cluster_id)
            cluster.child_cluster_ids = list(child_cluster.child_cluster_ids)

            for grandchild_cluster_id in cluster.child_cluster_ids:
                clusters[grandchild_cluster_id].parent_cluster_id = cluster_id

        reachable_cluster_ids.add(cluster_id)
        return cluster_id

    collapsed_top_cluster_ids = [collapse(cluster_id) for cluster_id in top_cluster_ids]

    for redundant_cluster_id in redundant_cluster_ids:
        clusters.pop(redundant_cluster_id, None)

    for cluster_id in list(clusters):
        if cluster_id not in reachable_cluster_ids:
            clusters.pop(cluster_id, None)

    return [
        cluster_id for cluster_id in collapsed_top_cluster_ids if cluster_id in clusters
    ]


def _assign_cluster_geometry(
    clusters: dict[str, ThresholdHierarchyCluster],
    node_positions: dict[str, tuple[float, float]],
) -> None:
    geometry_by_cluster_id: dict[
        str, tuple[int, float, float, float, float, float, float]
    ] = {}
    ordered_clusters = sorted(
        clusters.values(),
        key=lambda cluster: cluster.distance_threshold_level,
        reverse=True,
    )

    for cluster in ordered_clusters:
        count = 0
        sum_x = 0.0
        sum_y = 0.0
        min_x = float("inf")
        max_x = float("-inf")
        min_y = float("inf")
        max_y = float("-inf")

        for child_cluster_id in cluster.child_cluster_ids:
            child_geometry = geometry_by_cluster_id.get(child_cluster_id)
            if child_geometry is None:
                continue
            (
                child_count,
                child_sum_x,
                child_sum_y,
                child_min_x,
                child_max_x,
                child_min_y,
                child_max_y,
            ) = child_geometry
            count += child_count
            sum_x += child_sum_x
            sum_y += child_sum_y
            min_x = min(min_x, child_min_x)
            max_x = max(max_x, child_max_x)
            min_y = min(min_y, child_min_y)
            max_y = max(max_y, child_max_y)

        if count == 0:
            node_id = cluster.representative_node_id or (
                cluster.member_node_ids[0] if cluster.member_node_ids else None
            )
            position = node_positions.get(node_id) if node_id is not None else None
            if position is None:
                continue
            x, y = position
            count = 1
            sum_x = x
            sum_y = y
            min_x = x
            max_x = x
            min_y = y
            max_y = y

        geometry_by_cluster_id[cluster.cluster_id] = (
            count,
            sum_x,
            sum_y,
            min_x,
            max_x,
            min_y,
            max_y,
        )
        cluster.centroid = {
            "x": sum_x / count,
            "y": sum_y / count,
        }
        cluster.bounds = {
            "min_x": min_x,
            "max_x": max_x,
            "min_y": min_y,
            "max_y": max_y,
        }


def _max_distance_threshold_level(
    clusters: dict[str, ThresholdHierarchyCluster],
) -> int:
    return max(
        (cluster.distance_threshold_level for cluster in clusters.values()),
        default=0,
    )


def _cluster_ids_by_level(
    clusters: dict[str, ThresholdHierarchyCluster],
) -> dict[int, list[str]]:
    cluster_ids_by_level: dict[int, list[str]] = {}
    for cluster in clusters.values():
        cluster_ids_by_level.setdefault(
            cluster.distance_threshold_level,
            [],
        ).append(cluster.cluster_id)

    return {
        level: sorted(cluster_ids)
        for level, cluster_ids in sorted(cluster_ids_by_level.items())
    }


def _spatial_index_by_level(
    clusters: dict[str, ThresholdHierarchyCluster],
) -> dict[int, SpatialLevelIndex]:
    entries_by_level = _spatial_entries_by_level(clusters)
    return {
        level: build_str_spatial_index(level, entries)
        for level, entries in sorted(entries_by_level.items())
    }


def _spatial_entries_by_level(
    clusters: dict[str, ThresholdHierarchyCluster],
) -> dict[int, list[tuple[str, SpatialBounds]]]:
    entries_by_level: dict[int, list[tuple[str, SpatialBounds]]] = {}
    for cluster in clusters.values():
        bounds = spatial_bounds_from_cluster_bounds(cluster.bounds)
        if bounds is None:
            continue
        entries_by_level.setdefault(
            cluster.distance_threshold_level,
            [],
        ).append((cluster.cluster_id, bounds))

    return entries_by_level


def _node_positions_from_dataset(
    dataset: CanonicalDataset,
) -> dict[str, tuple[float, float]]:
    positions = {
        node.id: (node.x, node.y)
        for node in dataset.nodes
        if node.x is not None and node.y is not None
    }

    if len(positions) != len(dataset.nodes):
        raise ThresholdHierarchyBuildError(ERR_THRESHOLD_MISSING_POSITION)

    return positions
