from __future__ import annotations

from dataclasses import dataclass
from heapq import heappop, heappush

from phylo_lens_server.clustering.spatial import (
    BoundsTuple,
    bounds_distance,
    bounds_overlap_ratio,
    viewport_to_bounds,
)
from phylo_lens_server.clustering.spatial_index import query_spatial_index
from phylo_lens_server.clustering.threshold_hierarchy import (
    THRESHOLD_SYNTHETIC_ROOT_ID,
)
from phylo_lens_server.core.models import (
    CanonicalDataset,
    ThresholdHierarchyCluster,
    ThresholdHierarchyIndex,
    VisibleSliceQuery,
)

DEFAULT_MAX_NODES_FALLBACK = 10_000
ZOOM_OVERVIEW_THRESHOLD = 0.75
ZOOM_EXPANSION_THRESHOLD = 1.0


@dataclass(frozen=True)
class ClusterViewSelection:
    visible_order: list[str]
    expanded_cluster_ids: set[str]


def select_cluster_view(
    dataset: CanonicalDataset,
    hierarchy: ThresholdHierarchyIndex,
    query: VisibleSliceQuery,
) -> ClusterViewSelection:
    """Choose the hierarchy clusters that should participate in the visible slice."""
    max_nodes = resolve_max_nodes(dataset, query)
    viewport_bounds = viewport_to_bounds(query.viewport)
    target_level = target_level_for_query(hierarchy, query)
    focus_path_cluster_ids_set = focus_path_cluster_ids(
        hierarchy,
        query.focus_node_id,
    )
    spatial_candidate_cluster_ids = spatial_candidate_cluster_ids_for_viewport(
        hierarchy,
        viewport_bounds,
        target_level,
    )

    if spatial_candidate_cluster_ids is not None:
        spatial_candidate_cluster_ids.update(focus_path_cluster_ids_set)

    visible_order, expanded_cluster_ids = visible_cluster_order(
        hierarchy=hierarchy,
        query=query,
        max_nodes=max_nodes,
        viewport_bounds=viewport_bounds,
        target_level=target_level,
        focus_path_cluster_ids=focus_path_cluster_ids_set,
        spatial_candidate_cluster_ids=spatial_candidate_cluster_ids,
    )

    return ClusterViewSelection(
        visible_order=visible_order,
        expanded_cluster_ids=expanded_cluster_ids,
    )


def resolve_max_nodes(
    dataset: CanonicalDataset,
    query: VisibleSliceQuery,
) -> int:
    return query.max_nodes or min(len(dataset.nodes), DEFAULT_MAX_NODES_FALLBACK)


def focus_path_cluster_ids(
    hierarchy: ThresholdHierarchyIndex,
    focus_node_id: str | None,
) -> set[str]:
    if focus_node_id is None:
        return set()

    representative_node_to_cluster_id = {
        cluster.representative_node_id: cluster_id
        for cluster_id, cluster in hierarchy.clusters.items()
        if cluster.representative_node_id is not None
    }

    cluster_id = representative_node_to_cluster_id.get(focus_node_id)

    if cluster_id is None:
        return set()

    path: set[str] = set()
    current_cluster_id: str | None = cluster_id

    while current_cluster_id is not None:
        path.add(current_cluster_id)
        current_cluster_id = hierarchy.clusters[current_cluster_id].parent_cluster_id

    return path


def spatial_candidate_cluster_ids_for_viewport(
    hierarchy: ThresholdHierarchyIndex,
    viewport_bounds: BoundsTuple,
    target_level: int,
) -> set[str] | None:
    if not hierarchy.spatial_index_by_level:
        return None

    candidates = {hierarchy.root_cluster_id}

    for level, index in hierarchy.spatial_index_by_level.items():
        if level <= target_level:
            candidates.update(query_spatial_index(index, viewport_bounds))

    return candidates


def visible_cluster_order(
    hierarchy: ThresholdHierarchyIndex,
    query: VisibleSliceQuery,
    max_nodes: int,
    viewport_bounds: BoundsTuple,
    target_level: int,
    focus_path_cluster_ids: set[str],
    spatial_candidate_cluster_ids: set[str] | None,
) -> tuple[list[str], set[str]]:
    visible_cluster_ids = {hierarchy.root_cluster_id}
    visible_order = [hierarchy.root_cluster_id]
    expanded_cluster_ids: set[str] = set()

    frontier: list[tuple[FrontierSortKey, str]] = []
    push_frontier_cluster(
        frontier=frontier,
        hierarchy=hierarchy,
        cluster_id=hierarchy.root_cluster_id,
        focus_path_cluster_ids=focus_path_cluster_ids,
        viewport_bounds=viewport_bounds,
        max_nodes=max_nodes,
        expanded_cluster_ids=expanded_cluster_ids,
    )

    while frontier:
        _, cluster_id = heappop(frontier)
        cluster = hierarchy.clusters[cluster_id]

        if not should_expand_cluster(hierarchy, query, cluster, target_level):
            continue

        children = visible_child_cluster_ids(
            hierarchy=hierarchy,
            child_cluster_ids=cluster.child_cluster_ids,
            focus_path_cluster_ids=focus_path_cluster_ids,
            viewport_bounds=viewport_bounds,
            spatial_candidate_cluster_ids=spatial_candidate_cluster_ids,
            expanded_cluster_ids=expanded_cluster_ids,
        )

        if not children:
            continue

        if len(visible_cluster_ids) + len(children) > max_nodes:
            continue

        expanded_cluster_ids.add(cluster_id)

        for child_cluster_id in children:
            if child_cluster_id in visible_cluster_ids:
                continue

            visible_cluster_ids.add(child_cluster_id)
            visible_order.append(child_cluster_id)

            push_frontier_cluster(
                frontier=frontier,
                hierarchy=hierarchy,
                cluster_id=child_cluster_id,
                focus_path_cluster_ids=focus_path_cluster_ids,
                viewport_bounds=viewport_bounds,
                max_nodes=max_nodes,
                expanded_cluster_ids=expanded_cluster_ids,
            )

    return visible_order, expanded_cluster_ids


FrontierSortKey = tuple[int, int, float, float, int, str]


def push_frontier_cluster(
    frontier: list[tuple[FrontierSortKey, str]],
    hierarchy: ThresholdHierarchyIndex,
    cluster_id: str,
    focus_path_cluster_ids: set[str],
    viewport_bounds: BoundsTuple,
    max_nodes: int,
    expanded_cluster_ids: set[str] | None = None,
) -> None:
    heappush(
        frontier,
        (
            frontier_sort_key(
                hierarchy=hierarchy,
                cluster_id=cluster_id,
                focus_path_cluster_ids=focus_path_cluster_ids,
                viewport_bounds=viewport_bounds,
                max_nodes=max_nodes,
                expanded_cluster_ids=expanded_cluster_ids,
            ),
            cluster_id,
        ),
    )


def frontier_sort_key(
    hierarchy: ThresholdHierarchyIndex,
    cluster_id: str,
    focus_path_cluster_ids: set[str],
    viewport_bounds: BoundsTuple,
    max_nodes: int,
    expanded_cluster_ids: set[str] | None = None,
) -> FrontierSortKey:
    cluster = hierarchy.clusters[cluster_id]
    overlap_ratio = bounds_overlap_ratio(cluster.bounds, viewport_bounds)
    distance = bounds_distance(cluster.bounds, viewport_bounds)

    return (
        0 if cluster_id in focus_path_cluster_ids else 1,
        0 if overlap_ratio > 0 else 1,
        -overlap_ratio,
        distance,
        -min(cluster.subtree_size, max_nodes),
        cluster.representative_node_id or "",
    )


def visible_child_cluster_ids(
    hierarchy: ThresholdHierarchyIndex,
    child_cluster_ids: list[str],
    focus_path_cluster_ids: set[str],
    viewport_bounds: BoundsTuple,
    spatial_candidate_cluster_ids: set[str] | None,
    expanded_cluster_ids: set[str] | None = None,
) -> list[str]:
    relevant_child_cluster_ids = [
        cluster_id
        for cluster_id in child_cluster_ids
        if is_view_relevant_cluster(
            hierarchy=hierarchy,
            cluster_id=cluster_id,
            focus_path_cluster_ids=focus_path_cluster_ids,
            viewport_bounds=viewport_bounds,
            spatial_candidate_cluster_ids=spatial_candidate_cluster_ids,
            expanded_cluster_ids=expanded_cluster_ids,
        )
    ]

    return sorted(
        relevant_child_cluster_ids,
        key=lambda cluster_id: child_sort_key(
            hierarchy=hierarchy,
            cluster_id=cluster_id,
            focus_path_cluster_ids=focus_path_cluster_ids,
            viewport_bounds=viewport_bounds,
            spatial_candidate_cluster_ids=spatial_candidate_cluster_ids,
        ),
    )


def child_sort_key(
    hierarchy: ThresholdHierarchyIndex,
    cluster_id: str,
    focus_path_cluster_ids: set[str],
    viewport_bounds: BoundsTuple,
    spatial_candidate_cluster_ids: set[str] | None,
) -> tuple[int, int, int, str]:
    cluster = hierarchy.clusters[cluster_id]
    overlap_ratio = bounds_overlap_ratio(cluster.bounds, viewport_bounds)

    return (
        0 if cluster_id in focus_path_cluster_ids else 1,
        (
            0
            if spatial_candidate_cluster_ids is None
            or cluster_id in spatial_candidate_cluster_ids
            else 1
        ),
        0 if overlap_ratio > 0 else 1,
        cluster.representative_node_id or "",
    )


def is_view_relevant_cluster(
    hierarchy: ThresholdHierarchyIndex,
    cluster_id: str,
    focus_path_cluster_ids: set[str],
    viewport_bounds: BoundsTuple,
    spatial_candidate_cluster_ids: set[str] | None,
    expanded_cluster_ids: set[str] | None = None,
) -> bool:
    if cluster_id in focus_path_cluster_ids:
        return True

    if expanded_cluster_ids is not None and cluster_id in expanded_cluster_ids:
        return True

    if is_synthetic_root(hierarchy, cluster_id):
        return True

    if spatial_candidate_cluster_ids is not None:
        return cluster_id in spatial_candidate_cluster_ids

    return (
        bounds_overlap_ratio(
            hierarchy.clusters[cluster_id].bounds,
            viewport_bounds,
        )
        > 0
    )


def should_expand_cluster(
    hierarchy: ThresholdHierarchyIndex,
    query: VisibleSliceQuery,
    cluster: ThresholdHierarchyCluster,
    target_level: int,
) -> bool:
    if not cluster.child_cluster_ids:
        return False

    if cluster.cluster_id in query.collapsed_cluster_ids:
        return False

    if is_synthetic_root(hierarchy, cluster.cluster_id):
        return True

    if cluster.cluster_id in query.expanded_cluster_ids:
        return True

    if query.focus_cluster_id == cluster.cluster_id:
        return True

    if (
        query.lod_hint is not None
        and cluster.distance_threshold_level >= query.lod_hint
    ):
        return False

    if query.zoom < ZOOM_OVERVIEW_THRESHOLD:
        return False

    if query.zoom <= ZOOM_EXPANSION_THRESHOLD and cluster.distance_threshold_level >= 1:
        return False

    return cluster.distance_threshold_level < target_level


def target_level_for_query(
    hierarchy: ThresholdHierarchyIndex,
    query: VisibleSliceQuery,
) -> int:
    max_level = hierarchy.max_distance_threshold_level

    if query.lod_hint is not None:
        return min(max_level, max(0, query.lod_hint))

    if query.zoom <= ZOOM_EXPANSION_THRESHOLD:
        return 1 if has_synthetic_root(hierarchy) else 0

    if has_synthetic_root(hierarchy):
        return min(max_level, max(1, int(query.zoom) + 1))

    return min(max_level, max(0, int(query.zoom)))


def has_synthetic_root(hierarchy: ThresholdHierarchyIndex) -> bool:
    return hierarchy.root_cluster_id == THRESHOLD_SYNTHETIC_ROOT_ID


def is_synthetic_root(
    hierarchy: ThresholdHierarchyIndex,
    cluster_id: str,
) -> bool:
    return has_synthetic_root(hierarchy) and cluster_id == hierarchy.root_cluster_id
