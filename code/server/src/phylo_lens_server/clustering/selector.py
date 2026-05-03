from __future__ import annotations

from heapq import heappop, heappush

from phylo_lens_server.clustering.threshold_hierarchy import (
    THRESHOLD_SYNTHETIC_ROOT_ID,
)
from phylo_lens_server.clustering.spatial import (
    BoundsTuple,
    bounds_distance,
    bounds_overlap_ratio,
    spatial_bounds_from_cluster_bounds,
    viewport_to_bounds,
)
from phylo_lens_server.clustering.spatial_index import query_spatial_index
from phylo_lens_server.core.models import (
    CanonicalDataset,
    CanonicalEdge,
    CanonicalNode,
    CollapsedCluster,
    SpatialBounds,
    ThresholdHierarchyCluster,
    ThresholdHierarchyIndex,
    VisibleSliceQuery,
    VisibleSliceResponse,
    VisibleSliceViewMeta,
)

DEFAULT_MAX_NODES_FALLBACK = 10_000
ZOOM_OVERVIEW_THRESHOLD = 0.75
ZOOM_EXPANSION_THRESHOLD = 1.0

ERR_SELECTOR_DATASET_MISMATCH = "Visible-slice query dataset '{query_dataset_id}' does not match hierarchy/dataset '{dataset_id}'."


class VisibleSliceSelectionError(ValueError):
    """Raised when a visible slice cannot be selected from the given inputs."""


def select_visible_slice(
    dataset: CanonicalDataset,
    hierarchy: ThresholdHierarchyIndex,
    query: VisibleSliceQuery,
) -> VisibleSliceResponse:
    """Select a deterministic visible slice from a threshold hierarchy."""
    _validate_dataset_match(dataset, hierarchy, query)

    max_nodes = query.max_nodes or min(len(dataset.nodes), DEFAULT_MAX_NODES_FALLBACK)
    viewport_bounds = viewport_to_bounds(query.viewport)
    target_level = _target_level(hierarchy, query)
    focus_path_cluster_ids = _focus_path_cluster_ids(
        hierarchy, query.focus_node_id
    )
    spatial_candidate_cluster_ids = _spatial_candidate_cluster_ids(
        hierarchy,
        viewport_bounds,
        target_level,
    )
    if spatial_candidate_cluster_ids is not None:
        spatial_candidate_cluster_ids.update(focus_path_cluster_ids)

    visible_order, expanded_cluster_ids = _visible_cluster_order(
        hierarchy,
        query,
        max_nodes,
        viewport_bounds,
        target_level,
        focus_path_cluster_ids,
        spatial_candidate_cluster_ids,
    )

    node_by_id = {node.id: node for node in dataset.nodes}
    visible_nodes, visible_node_id_set, rendered_cluster_ids = _visible_nodes(
        hierarchy,
        node_by_id,
        visible_order,
        expanded_cluster_ids,
    )
    collapsed_clusters = _collapsed_clusters(
        hierarchy,
        visible_order,
        expanded_cluster_ids,
        rendered_cluster_ids,
        visible_nodes,
        visible_node_id_set,
        node_by_id,
    )
    visible_edges = _visible_edges(
        hierarchy,
        visible_order,
        rendered_cluster_ids,
        visible_node_id_set,
    )
    lod_level = _lod_level(hierarchy, rendered_cluster_ids)

    return VisibleSliceResponse(
        dataset_id=dataset.dataset_id,
        lod_level=lod_level,
        nodes=visible_nodes,
        edges=visible_edges,
        collapsed_clusters=collapsed_clusters,
        view_meta=VisibleSliceViewMeta(
            viewport=query.viewport,
            zoom=query.zoom,
            returned_node_count=len(visible_nodes),
            returned_edge_count=len(visible_edges),
            global_bounds=_global_bounds(hierarchy),
        ),
    )


def _validate_dataset_match(
    dataset: CanonicalDataset,
    hierarchy: ThresholdHierarchyIndex,
    query: VisibleSliceQuery,
) -> None:
    if (
        dataset.dataset_id == hierarchy.dataset_id
        and query.dataset_id == dataset.dataset_id
    ):
        return

    raise VisibleSliceSelectionError(
        ERR_SELECTOR_DATASET_MISMATCH.format(
            query_dataset_id=query.dataset_id,
            dataset_id=dataset.dataset_id,
        )
    )


def _focus_path_cluster_ids(
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


def _spatial_candidate_cluster_ids(
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


def _visible_cluster_order(
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
    frontier: list[tuple[tuple[int, int, float, float, int, str], str]] = []
    heappush(
        frontier,
        (
            _frontier_sort_key(
                hierarchy,
                hierarchy.root_cluster_id,
                focus_path_cluster_ids,
                viewport_bounds,
                max_nodes,
            ),
            hierarchy.root_cluster_id,
        ),
    )

    while frontier:
        _, cluster_id = heappop(frontier)
        cluster = hierarchy.clusters[cluster_id]
        if not _should_expand_cluster(hierarchy, query, cluster, target_level):
            continue

        children = _visible_child_cluster_ids(
            hierarchy,
            cluster.child_cluster_ids,
            focus_path_cluster_ids,
            viewport_bounds,
            spatial_candidate_cluster_ids,
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
            heappush(
                frontier,
                (
                    _frontier_sort_key(
                        hierarchy,
                        child_cluster_id,
                        focus_path_cluster_ids,
                        viewport_bounds,
                        max_nodes,
                    ),
                    child_cluster_id,
                ),
            )

    return visible_order, expanded_cluster_ids


def _frontier_sort_key(
    hierarchy: ThresholdHierarchyIndex,
    cluster_id: str,
    focus_path_cluster_ids: set[str],
    viewport_bounds: BoundsTuple,
    max_nodes: int,
) -> tuple[int, int, float, float, int, str]:
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


def _visible_child_cluster_ids(
    hierarchy: ThresholdHierarchyIndex,
    child_cluster_ids: list[str],
    focus_path_cluster_ids: set[str],
    viewport_bounds: BoundsTuple,
    spatial_candidate_cluster_ids: set[str] | None,
) -> list[str]:
    return sorted(
        (
            cluster_id
            for cluster_id in child_cluster_ids
            if _is_view_relevant_cluster(
                hierarchy,
                cluster_id,
                focus_path_cluster_ids,
                viewport_bounds,
                spatial_candidate_cluster_ids,
            )
        ),
        key=lambda cluster_id: (
            0 if cluster_id in focus_path_cluster_ids else 1,
            0
            if bounds_overlap_ratio(
                hierarchy.clusters[cluster_id].bounds,
                viewport_bounds,
            )
            > 0
            else 1,
            hierarchy.clusters[cluster_id].representative_node_id or "",
        ),
    )


def _is_view_relevant_cluster(
    hierarchy: ThresholdHierarchyIndex,
    cluster_id: str,
    focus_path_cluster_ids: set[str],
    viewport_bounds: BoundsTuple,
    spatial_candidate_cluster_ids: set[str] | None,
) -> bool:
    if cluster_id in focus_path_cluster_ids:
        return True
    if _is_synthetic_root(hierarchy, cluster_id):
        return True
    if spatial_candidate_cluster_ids is not None:
        return cluster_id in spatial_candidate_cluster_ids
    return bounds_overlap_ratio(
        hierarchy.clusters[cluster_id].bounds,
        viewport_bounds,
    ) > 0


def _should_expand_cluster(
    hierarchy: ThresholdHierarchyIndex,
    query: VisibleSliceQuery,
    cluster: ThresholdHierarchyCluster,
    target_level: int,
) -> bool:
    if not cluster.child_cluster_ids:
        return False
    if _is_synthetic_root(hierarchy, cluster.cluster_id):
        return True
    if (
        query.lod_hint is not None
        and cluster.distance_threshold_level >= query.lod_hint
    ):
        return False
    if query.zoom < ZOOM_OVERVIEW_THRESHOLD:
        return False
    if (
        query.zoom <= ZOOM_EXPANSION_THRESHOLD
        and cluster.distance_threshold_level >= 1
    ):
        return False
    return cluster.distance_threshold_level < target_level


def _target_level(
    hierarchy: ThresholdHierarchyIndex,
    query: VisibleSliceQuery,
) -> int:
    max_level = hierarchy.max_distance_threshold_level
    if query.lod_hint is not None:
        return min(max_level, max(0, query.lod_hint))
    if query.zoom <= ZOOM_EXPANSION_THRESHOLD:
        return 1 if _has_synthetic_root(hierarchy) else 0
    if _has_synthetic_root(hierarchy):
        return min(max_level, max(1, int(query.zoom) + 1))
    return min(max_level, max(0, int(query.zoom)))


def _visible_nodes(
    hierarchy: ThresholdHierarchyIndex,
    node_by_id: dict[str, CanonicalNode],
    visible_order: list[str],
    expanded_cluster_ids: set[str],
) -> tuple[list[CanonicalNode], set[str], set[str]]:
    visible_nodes: list[CanonicalNode] = []
    visible_node_id_set: set[str] = set()
    rendered_cluster_ids: set[str] = set()

    for cluster_id in visible_order:
        if _is_synthetic_root(hierarchy, cluster_id):
            continue
        if _append_cluster_node(
            visible_nodes,
            visible_node_id_set,
            hierarchy,
            node_by_id,
            cluster_id,
            is_cluster_proxy=_is_cluster_proxy_cluster(
                hierarchy,
                cluster_id,
                expanded_cluster_ids,
            ),
        ):
            rendered_cluster_ids.add(cluster_id)

    return visible_nodes, visible_node_id_set, rendered_cluster_ids


def _collapsed_clusters(
    hierarchy: ThresholdHierarchyIndex,
    visible_order: list[str],
    expanded_cluster_ids: set[str],
    rendered_cluster_ids: set[str],
    visible_nodes: list[CanonicalNode],
    visible_node_id_set: set[str],
    node_by_id: dict[str, CanonicalNode],
) -> list[CollapsedCluster]:
    collapsed_clusters: list[CollapsedCluster] = []

    for cluster_id in visible_order:
        if (
            _is_synthetic_root(hierarchy, cluster_id)
            or cluster_id in expanded_cluster_ids
        ):
            continue
        if cluster_id in rendered_cluster_ids and _is_cluster_proxy_cluster(
            hierarchy,
            cluster_id,
            expanded_cluster_ids,
        ):
            continue

        for child_cluster_id in hierarchy.clusters[cluster_id].child_cluster_ids:
            child_cluster = hierarchy.clusters[child_cluster_id]
            if (
                child_cluster.subtree_size <= 1
                or child_cluster_id in rendered_cluster_ids
            ):
                continue

            collapsed_clusters.append(
                CollapsedCluster(
                    cluster_id=child_cluster.cluster_id,
                    representative_node_id=child_cluster.representative_node_id,
                    subtree_size=child_cluster.subtree_size,
                    centroid=child_cluster.centroid,
                )
            )
            if (
                child_cluster.representative_node_id is not None
                and child_cluster.representative_node_id not in visible_node_id_set
                and _append_cluster_node(
                    visible_nodes,
                    visible_node_id_set,
                    hierarchy,
                    node_by_id,
                    child_cluster_id,
                    is_cluster_proxy=True,
                )
            ):
                rendered_cluster_ids.add(child_cluster_id)

    return collapsed_clusters


def _append_cluster_node(
    visible_nodes: list[CanonicalNode],
    visible_node_id_set: set[str],
    hierarchy: ThresholdHierarchyIndex,
    node_by_id: dict[str, CanonicalNode],
    cluster_id: str,
    is_cluster_proxy: bool,
) -> bool:
    cluster = hierarchy.clusters[cluster_id]
    node_id = cluster.representative_node_id
    if node_id is None or node_id in visible_node_id_set:
        return False

    base_node = node_by_id[node_id]
    visible_nodes.append(
        CanonicalNode(
            id=base_node.id,
            x=cluster.centroid["x"] if cluster.centroid is not None else base_node.x,
            y=cluster.centroid["y"] if cluster.centroid is not None else base_node.y,
            cluster_id=cluster.cluster_id,
            is_cluster_proxy=is_cluster_proxy,
            subtree_size=cluster.subtree_size if is_cluster_proxy else None,
            leaf_count=cluster.subtree_size if is_cluster_proxy else None,
        )
    )
    visible_node_id_set.add(node_id)
    return True


def _visible_edges(
    hierarchy: ThresholdHierarchyIndex,
    visible_order: list[str],
    rendered_cluster_ids: set[str],
    visible_node_id_set: set[str],
) -> list[CanonicalEdge]:
    visible_edges: list[CanonicalEdge] = []
    visible_edge_pairs: set[tuple[str, str]] = set()

    for cluster_id in visible_order:
        if (
            _is_synthetic_root(hierarchy, cluster_id)
            or cluster_id not in rendered_cluster_ids
        ):
            continue
        cluster = hierarchy.clusters[cluster_id]
        parent_node_id = cluster.representative_node_id
        if parent_node_id is None or parent_node_id not in visible_node_id_set:
            continue

        for child_cluster_id in cluster.child_cluster_ids:
            if child_cluster_id not in rendered_cluster_ids:
                continue
            child_cluster = hierarchy.clusters[child_cluster_id]
            child_node_id = child_cluster.representative_node_id
            if child_node_id is None or child_node_id not in visible_node_id_set:
                continue
            if parent_node_id == child_node_id:
                continue

            edge_pair = (parent_node_id, child_node_id)
            if edge_pair in visible_edge_pairs:
                continue
            visible_edge_pairs.add(edge_pair)
            visible_edges.append(
                CanonicalEdge(
                    id=f"hier_{cluster.cluster_id}_{child_cluster.cluster_id}",
                    source=parent_node_id,
                    target=child_node_id,
                )
            )

    return visible_edges


def _lod_level(
    hierarchy: ThresholdHierarchyIndex,
    rendered_cluster_ids: set[str],
) -> int:
    non_synthetic_cluster_ids = [
        cluster_id
        for cluster_id in rendered_cluster_ids
        if not _is_synthetic_root(hierarchy, cluster_id)
    ]
    if not non_synthetic_cluster_ids:
        return 0
    return max(
        hierarchy.clusters[cluster_id].distance_threshold_level
        for cluster_id in non_synthetic_cluster_ids
    )


def _is_cluster_proxy_cluster(
    hierarchy: ThresholdHierarchyIndex,
    cluster_id: str,
    expanded_cluster_ids: set[str],
) -> bool:
    cluster = hierarchy.clusters[cluster_id]
    return cluster.subtree_size > 1 and cluster_id not in expanded_cluster_ids


def _has_synthetic_root(hierarchy: ThresholdHierarchyIndex) -> bool:
    return hierarchy.root_cluster_id == THRESHOLD_SYNTHETIC_ROOT_ID


def _is_synthetic_root(hierarchy: ThresholdHierarchyIndex, cluster_id: str) -> bool:
    return _has_synthetic_root(hierarchy) and cluster_id == hierarchy.root_cluster_id


def _global_bounds(hierarchy: ThresholdHierarchyIndex) -> SpatialBounds | None:
    if hierarchy.global_bounds is not None:
        return hierarchy.global_bounds

    return spatial_bounds_from_cluster_bounds(
        hierarchy.clusters[hierarchy.root_cluster_id].bounds
    )
