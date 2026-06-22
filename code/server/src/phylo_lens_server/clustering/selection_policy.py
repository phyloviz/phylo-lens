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
from phylo_lens_server.core.models import (
    CanonicalDataset,
    ThresholdHierarchyCluster,
    ThresholdHierarchyIndex,
    VisibleSliceQuery,
)

DEFAULT_MAX_NODES_FALLBACK = 10_000
ZOOM_COARSE_LEVEL = 0.75
ZOOM_FINE_LEVEL = 3.0
MIN_AUTOMATIC_LOD_LEVEL = 1
VIEWPORT_MARGIN_FACTOR = 0.5


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
    target_level = target_level_for_query(hierarchy, query)
    viewport_bounds = inflated_bounds(
        viewport_to_bounds(query.viewport),
        VIEWPORT_MARGIN_FACTOR,
    )
    focus_path_cluster_ids_set = focus_path_cluster_ids(
        hierarchy,
        query.focus_node_id,
    )
    focus_path_cluster_ids_set.update(
        cluster_path_cluster_ids(
            hierarchy,
            query.focus_cluster_id,
        )
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

    cluster_id = deepest_cluster_id_containing_node(hierarchy, focus_node_id)

    if cluster_id is None:
        return set()

    path: set[str] = set()
    current_cluster_id: str | None = cluster_id

    while current_cluster_id is not None:
        path.add(current_cluster_id)
        current_cluster_id = hierarchy.clusters[current_cluster_id].parent_cluster_id

    return path


def deepest_cluster_id_containing_node(
    hierarchy: ThresholdHierarchyIndex,
    node_id: str,
) -> str | None:
    matching_clusters = [
        cluster
        for cluster in hierarchy.clusters.values()
        if node_id in cluster.member_node_ids
    ]
    if not matching_clusters:
        return None

    return max(
        matching_clusters,
        key=lambda cluster: cluster.distance_threshold_level,
    ).cluster_id


def cluster_path_cluster_ids(
    hierarchy: ThresholdHierarchyIndex,
    focus_cluster_id: str | None,
) -> set[str]:
    if focus_cluster_id is None or focus_cluster_id not in hierarchy.clusters:
        return set()

    path: set[str] = set()
    current_cluster_id: str | None = focus_cluster_id

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

    candidates = set(hierarchy.top_cluster_ids)

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
    expanded_cluster_ids: set[str] = set()
    visible_cluster_ids = set(hierarchy.top_cluster_ids)
    visible_order = list(hierarchy.top_cluster_ids)

    frontier: list[tuple[FrontierSortKey, str]] = []

    for cluster_id in hierarchy.top_cluster_ids:
        push_frontier_cluster(
            frontier=frontier,
            hierarchy=hierarchy,
            cluster_id=cluster_id,
            focus_path_cluster_ids=focus_path_cluster_ids,
            viewport_bounds=viewport_bounds,
            max_nodes=max_nodes,
        )

    while frontier:
        _, cluster_id = heappop(frontier)
        cluster = hierarchy.clusters[cluster_id]
        force_expand = cluster_id in focus_path_cluster_ids or (
            cluster_id in query.expanded_cluster_ids
            or cluster_id == query.focus_cluster_id
        )
        view_relevant = is_view_relevant_cluster(
            hierarchy=hierarchy,
            cluster_id=cluster_id,
            focus_path_cluster_ids=focus_path_cluster_ids,
            viewport_bounds=viewport_bounds,
            spatial_candidate_cluster_ids=spatial_candidate_cluster_ids,
        )

        if not should_expand_cluster(
            query,
            cluster,
            target_level,
            force_expand=force_expand,
            view_relevant=view_relevant,
        ):
            continue

        children = visible_child_cluster_ids(
            hierarchy=hierarchy,
            child_cluster_ids=cluster.child_cluster_ids,
            focus_path_cluster_ids=focus_path_cluster_ids,
            viewport_bounds=viewport_bounds,
            spatial_candidate_cluster_ids=spatial_candidate_cluster_ids,
            force_all_children=True,
        )

        if not children:
            continue

        visible_count = len(visible_cluster_ids - expanded_cluster_ids)
        if visible_count - 1 + len(children) > max_nodes:
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
    force_all_children: bool = False,
) -> list[str]:
    if force_all_children:
        relevant_child_cluster_ids = child_cluster_ids
    else:
        relevant_child_cluster_ids = [
            cluster_id
            for cluster_id in child_cluster_ids
            if is_view_relevant_cluster(
                hierarchy=hierarchy,
                cluster_id=cluster_id,
                focus_path_cluster_ids=focus_path_cluster_ids,
                viewport_bounds=viewport_bounds,
                spatial_candidate_cluster_ids=spatial_candidate_cluster_ids,
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
) -> bool:
    if cluster_id in focus_path_cluster_ids:
        return True

    if cluster_id in hierarchy.top_cluster_ids:
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
    query: VisibleSliceQuery,
    cluster: ThresholdHierarchyCluster,
    target_level: int,
    *,
    force_expand: bool = False,
    view_relevant: bool = True,
) -> bool:
    if not cluster.child_cluster_ids:
        return False

    if cluster.cluster_id in query.collapsed_cluster_ids:
        return False

    if force_expand:
        return True

    if not view_relevant:
        return False

    if cluster.cluster_id in query.expanded_cluster_ids:
        return True

    if query.focus_cluster_id == cluster.cluster_id:
        return True

    return cluster.distance_threshold_level < target_level


def target_level_for_query(
    hierarchy: ThresholdHierarchyIndex,
    query: VisibleSliceQuery,
) -> int:
    max_level = hierarchy.max_distance_threshold_level

    if query.lod_hint is not None:
        return min(max_level, max(0, query.lod_hint))

    if query.zoom <= ZOOM_COARSE_LEVEL:
        return min(max_level, MIN_AUTOMATIC_LOD_LEVEL)

    if query.zoom >= ZOOM_FINE_LEVEL:
        return max_level

    zoom_ratio = (query.zoom - ZOOM_COARSE_LEVEL) / (
        ZOOM_FINE_LEVEL - ZOOM_COARSE_LEVEL
    )
    return min(
        max_level,
        max(
            MIN_AUTOMATIC_LOD_LEVEL,
            round(zoom_ratio**2 * max_level),
        ),
    )


def inflated_bounds(bounds: BoundsTuple, margin_factor: float) -> BoundsTuple:
    min_x, max_x, min_y, max_y = bounds
    margin_x = (max_x - min_x) * margin_factor / 2
    margin_y = (max_y - min_y) * margin_factor / 2
    return (
        min_x - margin_x,
        max_x + margin_x,
        min_y - margin_y,
        max_y + margin_y,
    )
