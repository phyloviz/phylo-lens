from __future__ import annotations

from phylo_lens_server.core.models import (
    CanonicalNode,
    CanonicalDataset,
    CollapsedCluster,
    HierarchyIndex,
    VisibleSliceQuery,
    VisibleSliceResponse,
    VisibleSliceViewMeta,
)

DEFAULT_OVERVIEW_DEPTH = 0
DEFAULT_MAX_NODES_FALLBACK = 10_000
ZOOM_OVERVIEW_THRESHOLD = 0.75
ZOOM_EXPANSION_THRESHOLD = 1.0
SELECTOR_NODE_GAP = 120.0
SELECTOR_LAYER_GAP = 150.0
DETAIL_VIEWPORT_MARGIN = 48.0

ERR_SELECTOR_DATASET_MISMATCH = "Visible-slice query dataset '{query_dataset_id}' does not match hierarchy/dataset '{dataset_id}'."


class VisibleSliceSelectionError(ValueError):
    """Raised when a visible slice cannot be selected from the given inputs."""


def select_visible_slice(
    dataset: CanonicalDataset,
    hierarchy: HierarchyIndex,
    query: VisibleSliceQuery,
) -> VisibleSliceResponse:
    """Select a deterministic visible slice from a hierarchy and runtime query."""
    if (
        dataset.dataset_id != hierarchy.dataset_id
        or query.dataset_id != dataset.dataset_id
    ):
        raise VisibleSliceSelectionError(
            ERR_SELECTOR_DATASET_MISMATCH.format(
                query_dataset_id=query.dataset_id,
                dataset_id=dataset.dataset_id,
            )
        )

    max_nodes = query.max_nodes or min(len(dataset.nodes), DEFAULT_MAX_NODES_FALLBACK)
    viewport_bounds = _viewport_bounds(query)

    visible_cluster_ids = {hierarchy.root_cluster_id}
    visible_order = [hierarchy.root_cluster_id]
    expanded_cluster_ids: set[str] = set()
    cluster_id_by_representative_node = {
        cluster.representative_node_id: cluster_id
        for cluster_id, cluster in hierarchy.clusters.items()
        if cluster.representative_node_id is not None
    }
    focus_path_cluster_ids = _focus_path_cluster_ids(
        hierarchy,
        cluster_id_by_representative_node.get(query.focus_node_id),
    )

    frontier = [hierarchy.root_cluster_id]
    while frontier:
        frontier.sort(
            key=lambda cluster_id: _frontier_sort_key(
                hierarchy,
                query,
                cluster_id,
                focus_path_cluster_ids,
                viewport_bounds,
            )
        )
        cluster_id = frontier.pop(0)
        cluster = hierarchy.clusters[cluster_id]
        children = cluster.child_cluster_ids

        if not children or not _should_expand_cluster(
            hierarchy,
            query,
            cluster_id,
            focus_path_cluster_ids,
            viewport_bounds,
        ):
            continue

        expansion_cost = len(children)
        if len(visible_cluster_ids) + expansion_cost > max_nodes:
            continue

        expanded_cluster_ids.add(cluster_id)
        for child_cluster_id in _ordered_child_cluster_ids(
            hierarchy,
            children,
            focus_path_cluster_ids,
        ):
            if child_cluster_id in visible_cluster_ids:
                continue
            visible_cluster_ids.add(child_cluster_id)
            visible_order.append(child_cluster_id)
            frontier.append(child_cluster_id)

    node_by_id = {node.id: node for node in dataset.nodes}
    visible_nodes: list[CanonicalNode] = []
    visible_node_id_set: set[str] = set()
    for cluster_id in visible_order:
        _append_cluster_node(
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
        )

    visible_edges = []

    collapsed_clusters: list[CollapsedCluster] = []
    for cluster_id in visible_order:
        if cluster_id in expanded_cluster_ids:
            continue
        cluster = hierarchy.clusters[cluster_id]
        for child_cluster_id in cluster.child_cluster_ids:
            child_cluster = hierarchy.clusters[child_cluster_id]
            if (
                child_cluster_id in visible_cluster_ids
                or child_cluster.subtree_size <= 1
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
            ):
                _append_cluster_node(
                    visible_nodes,
                    visible_node_id_set,
                    hierarchy,
                    node_by_id,
                    child_cluster_id,
                    is_cluster_proxy=True,
                )

    visible_edges.extend(
        edge
        for edge in dataset.edges
        if edge.source in visible_node_id_set and edge.target in visible_node_id_set
    )

    lod_level = max(
        hierarchy.clusters[cluster_id].depth for cluster_id in visible_order
    )

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


def _append_cluster_node(
    visible_nodes: list[CanonicalNode],
    visible_node_id_set: set[str],
    hierarchy: HierarchyIndex,
    node_by_id: dict[str, CanonicalNode],
    cluster_id: str,
    is_cluster_proxy: bool,
) -> None:
    cluster = hierarchy.clusters[cluster_id]
    node_id = cluster.representative_node_id
    if node_id is None or node_id in visible_node_id_set:
        return
    base_node = node_by_id[node_id]
    visible_nodes.append(
        CanonicalNode(
            id=base_node.id,
            x=cluster.centroid["x"] if cluster.centroid is not None else base_node.x,
            y=cluster.centroid["y"] if cluster.centroid is not None else base_node.y,
            cluster_id=cluster.cluster_id,
            is_cluster_proxy=is_cluster_proxy,
            subtree_size=cluster.subtree_size if is_cluster_proxy else None,
            leaf_count=cluster.leaf_count if is_cluster_proxy else None,
        )
    )
    visible_node_id_set.add(node_id)


def _is_cluster_proxy_cluster(
    hierarchy: HierarchyIndex,
    cluster_id: str,
    expanded_cluster_ids: set[str],
) -> bool:
    cluster = hierarchy.clusters[cluster_id]
    return cluster.subtree_size > 1 and cluster_id not in expanded_cluster_ids


def _focus_path_cluster_ids(
    hierarchy: HierarchyIndex,
    focus_cluster_id: str | None,
) -> set[str]:
    if not focus_cluster_id or focus_cluster_id not in hierarchy.clusters:
        return set()

    path: set[str] = set()
    current_cluster_id: str | None = focus_cluster_id
    while current_cluster_id is not None:
        path.add(current_cluster_id)
        current_cluster_id = hierarchy.clusters[current_cluster_id].parent_cluster_id
    return path


def _ordered_child_cluster_ids(
    hierarchy: HierarchyIndex,
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


def _frontier_sort_key(
    hierarchy: HierarchyIndex,
    query: VisibleSliceQuery,
    cluster_id: str,
    focus_path_cluster_ids: set[str],
    viewport_bounds: tuple[float, float, float, float],
) -> tuple[int, int, float, float, int, str]:
    cluster = hierarchy.clusters[cluster_id]
    overlap_ratio = _viewport_overlap_ratio(cluster.bounds, viewport_bounds)
    distance = _viewport_distance(cluster.bounds, viewport_bounds)
    return (
        0 if cluster_id in focus_path_cluster_ids else 1,
        0 if overlap_ratio > 0 else 1,
        -overlap_ratio,
        distance,
        -min(cluster.subtree_size, query.max_nodes or DEFAULT_MAX_NODES_FALLBACK),
        cluster.representative_node_id or "",
    )


def _should_expand_cluster(
    hierarchy: HierarchyIndex,
    query: VisibleSliceQuery,
    cluster_id: str,
    focus_path_cluster_ids: set[str],
    viewport_bounds: tuple[float, float, float, float],
) -> bool:
    cluster = hierarchy.clusters[cluster_id]
    if query.lod_hint is not None and cluster.depth >= query.lod_hint:
        return False
    if query.zoom < ZOOM_OVERVIEW_THRESHOLD:
        return False
    if (
        query.zoom < ZOOM_EXPANSION_THRESHOLD
        and cluster.depth >= DEFAULT_OVERVIEW_DEPTH
    ):
        return False
    if cluster_id in focus_path_cluster_ids:
        return True

    overlap_ratio = _viewport_overlap_ratio(cluster.bounds, viewport_bounds)
    if overlap_ratio > 0:
        return True

    if cluster.depth == DEFAULT_OVERVIEW_DEPTH:
        return True

    distance = _viewport_distance(cluster.bounds, viewport_bounds)
    return distance <= DETAIL_VIEWPORT_MARGIN * max(query.zoom, 1.0)


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
