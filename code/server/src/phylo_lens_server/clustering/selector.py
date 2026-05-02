from __future__ import annotations

from heapq import heappop, heappush

from phylo_lens_server.clustering.threshold_hierarchy import (
    THRESHOLD_SYNTHETIC_ROOT_ID,
)
from phylo_lens_server.core.models import (
    CanonicalDataset,
    CanonicalEdge,
    CanonicalNode,
    CollapsedCluster,
    HierarchyIndex,
    ThresholdHierarchyCluster,
    ThresholdHierarchyIndex,
    VisibleSliceQuery,
    VisibleSliceResponse,
    VisibleSliceViewMeta,
)

DEFAULT_MAX_NODES_FALLBACK = 10_000
ZOOM_OVERVIEW_THRESHOLD = 0.75
ZOOM_EXPANSION_THRESHOLD = 1.0
SELECTOR_NODE_GAP = 120.0
SELECTOR_LAYER_GAP = 150.0

ERR_SELECTOR_DATASET_MISMATCH = "Visible-slice query dataset '{query_dataset_id}' does not match hierarchy/dataset '{dataset_id}'."
ERR_SELECTOR_UNSUPPORTED_HIERARCHY = (
    "Visible-slice selection currently supports only distance-threshold hierarchies."
)


class VisibleSliceSelectionError(ValueError):
    """Raised when a visible slice cannot be selected from the given inputs."""


def select_visible_slice(
    dataset: CanonicalDataset,
    hierarchy: HierarchyIndex | ThresholdHierarchyIndex,
    query: VisibleSliceQuery,
) -> VisibleSliceResponse:
    """Select a deterministic visible slice from a threshold hierarchy."""
    threshold_hierarchy = _require_threshold_hierarchy(hierarchy)
    _validate_dataset_match(dataset, threshold_hierarchy, query)

    max_nodes = query.max_nodes or min(len(dataset.nodes), DEFAULT_MAX_NODES_FALLBACK)
    viewport_bounds = _viewport_bounds(query)
    target_level = _target_level(threshold_hierarchy, query)
    focus_path_cluster_ids = _focus_path_cluster_ids(
        threshold_hierarchy, query.focus_node_id
    )

    visible_order, expanded_cluster_ids = _visible_cluster_order(
        threshold_hierarchy,
        query,
        max_nodes,
        viewport_bounds,
        target_level,
        focus_path_cluster_ids,
    )

    node_by_id = {node.id: node for node in dataset.nodes}
    visible_nodes, visible_node_id_set, rendered_cluster_ids = _visible_nodes(
        threshold_hierarchy,
        node_by_id,
        visible_order,
        expanded_cluster_ids,
    )
    collapsed_clusters = _collapsed_clusters(
        threshold_hierarchy,
        visible_order,
        expanded_cluster_ids,
        rendered_cluster_ids,
        visible_nodes,
        visible_node_id_set,
        node_by_id,
    )
    visible_edges = _visible_edges(
        threshold_hierarchy,
        visible_order,
        rendered_cluster_ids,
        visible_node_id_set,
    )
    lod_level = _lod_level(threshold_hierarchy, rendered_cluster_ids)

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
        ),
    )


def _require_threshold_hierarchy(
    hierarchy: HierarchyIndex | ThresholdHierarchyIndex,
) -> ThresholdHierarchyIndex:
    if not isinstance(hierarchy, ThresholdHierarchyIndex):
        raise VisibleSliceSelectionError(ERR_SELECTOR_UNSUPPORTED_HIERARCHY)
    return hierarchy


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


def _visible_cluster_order(
    hierarchy: ThresholdHierarchyIndex,
    query: VisibleSliceQuery,
    max_nodes: int,
    viewport_bounds: tuple[float, float, float, float],
    target_level: int,
    focus_path_cluster_ids: set[str],
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

        children = _ordered_child_cluster_ids(
            hierarchy,
            cluster.child_cluster_ids,
            focus_path_cluster_ids,
        )
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
    viewport_bounds: tuple[float, float, float, float],
    max_nodes: int,
) -> tuple[int, int, float, float, int, str]:
    cluster = hierarchy.clusters[cluster_id]
    overlap_ratio = _viewport_overlap_ratio(cluster.bounds, viewport_bounds)
    distance = _viewport_distance(cluster.bounds, viewport_bounds)
    return (
        0 if cluster_id in focus_path_cluster_ids else 1,
        0 if overlap_ratio > 0 else 1,
        -overlap_ratio,
        distance,
        -min(cluster.subtree_size, max_nodes),
        cluster.representative_node_id or "",
    )


def _ordered_child_cluster_ids(
    hierarchy: ThresholdHierarchyIndex,
    child_cluster_ids: list[str],
    focus_path_cluster_ids: set[str],
) -> list[str]:
    return sorted(
        child_cluster_ids,
        key=lambda cluster_id: (
            0 if cluster_id in focus_path_cluster_ids else 1,
            hierarchy.clusters[cluster_id].representative_node_id or "",
        ),
    )


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
    if query.zoom <= ZOOM_EXPANSION_THRESHOLD and cluster.distance_threshold_level >= 1:
        return False
    return cluster.distance_threshold_level < target_level


def _target_level(
    hierarchy: ThresholdHierarchyIndex,
    query: VisibleSliceQuery,
) -> int:
    max_level = max(
        cluster.distance_threshold_level
        for cluster_id, cluster in hierarchy.clusters.items()
        if not _is_synthetic_root(hierarchy, cluster_id)
    )
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


def _viewport_bounds(
    query: VisibleSliceQuery,
) -> tuple[float, float, float, float]:
    half_width = query.viewport.width / 2
    half_height = query.viewport.height / 2
    return (
        query.viewport.x - half_width,
        query.viewport.x + half_width,
        query.viewport.y - half_height,
        query.viewport.y + half_height,
    )


def _viewport_overlap_ratio(
    bounds: dict[str, float] | None,
    viewport_bounds: tuple[float, float, float, float],
) -> float:
    if bounds is None:
        return 0.0

    cluster_min_x, cluster_max_x, cluster_min_y, cluster_max_y = _scaled_bounds(bounds)
    view_min_x, view_max_x, view_min_y, view_max_y = viewport_bounds
    intersect_width = min(cluster_max_x, view_max_x) - max(cluster_min_x, view_min_x)
    intersect_height = min(cluster_max_y, view_max_y) - max(cluster_min_y, view_min_y)
    if intersect_width <= 0 or intersect_height <= 0:
        return 0.0

    cluster_area = max(
        (cluster_max_x - cluster_min_x) * (cluster_max_y - cluster_min_y),
        1.0,
    )
    return (intersect_width * intersect_height) / cluster_area


def _viewport_distance(
    bounds: dict[str, float] | None,
    viewport_bounds: tuple[float, float, float, float],
) -> float:
    if bounds is None:
        return float("inf")

    cluster_min_x, cluster_max_x, cluster_min_y, cluster_max_y = _scaled_bounds(bounds)
    view_min_x, view_max_x, view_min_y, view_max_y = viewport_bounds

    dx = 0.0
    if cluster_max_x < view_min_x:
        dx = view_min_x - cluster_max_x
    elif cluster_min_x > view_max_x:
        dx = cluster_min_x - view_max_x

    dy = 0.0
    if cluster_max_y < view_min_y:
        dy = view_min_y - cluster_max_y
    elif cluster_min_y > view_max_y:
        dy = cluster_min_y - view_max_y

    return dx + dy


def _scaled_bounds(bounds: dict[str, float]) -> tuple[float, float, float, float]:
    return (
        bounds["min_x"] * SELECTOR_NODE_GAP,
        bounds["max_x"] * SELECTOR_NODE_GAP,
        bounds["min_y"] * SELECTOR_LAYER_GAP,
        bounds["max_y"] * SELECTOR_LAYER_GAP,
    )
