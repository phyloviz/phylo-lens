from __future__ import annotations

from phylo_lens_server.core.models import (
    SpatialBounds,
    ThresholdHierarchyCluster,
    Viewport,
)

SPATIAL_NODE_GAP = 150.0
SPATIAL_LAYER_GAP = 170.0

BoundsTuple = tuple[float, float, float, float]


def viewport_to_bounds(viewport: Viewport) -> BoundsTuple:
    """Convert a center/size viewport into min/max query bounds."""
    half_width = viewport.width / 2
    half_height = viewport.height / 2
    return (
        viewport.x - half_width,
        viewport.x + half_width,
        viewport.y - half_height,
        viewport.y + half_height,
    )


def scale_cluster_bounds(bounds: dict[str, float]) -> BoundsTuple:
    """Scale stored layout bounds into the client/server viewport coordinate space."""
    return (
        bounds["min_x"] * SPATIAL_NODE_GAP,
        bounds["max_x"] * SPATIAL_NODE_GAP,
        bounds["min_y"] * SPATIAL_LAYER_GAP,
        bounds["max_y"] * SPATIAL_LAYER_GAP,
    )


def spatial_bounds_from_cluster_bounds(
    bounds: dict[str, float] | None,
) -> SpatialBounds | None:
    if bounds is None:
        return None

    min_x, max_x, min_y, max_y = scale_cluster_bounds(bounds)
    return SpatialBounds(
        min_x=min_x,
        max_x=max_x,
        min_y=min_y,
        max_y=max_y,
    )


def global_bounds_from_top_clusters(
    clusters: dict[str, ThresholdHierarchyCluster],
    top_cluster_ids: list[str],
) -> SpatialBounds | None:
    bounds_list = [
        clusters[cluster_id].bounds
        for cluster_id in top_cluster_ids
        if clusters[cluster_id].bounds is not None
    ]

    if not bounds_list:
        return None

    merged = {
        "min_x": min(bounds["min_x"] for bounds in bounds_list),
        "max_x": max(bounds["max_x"] for bounds in bounds_list),
        "min_y": min(bounds["min_y"] for bounds in bounds_list),
        "max_y": max(bounds["max_y"] for bounds in bounds_list),
    }

    return spatial_bounds_from_cluster_bounds(merged)


def spatial_bounds_to_tuple(bounds: SpatialBounds) -> BoundsTuple:
    return (bounds.min_x, bounds.max_x, bounds.min_y, bounds.max_y)


def bounds_intersect(
    left: BoundsTuple,
    right: BoundsTuple,
) -> bool:
    left_min_x, left_max_x, left_min_y, left_max_y = left
    right_min_x, right_max_x, right_min_y, right_max_y = right
    return (
        left_min_x <= right_max_x
        and left_max_x >= right_min_x
        and left_min_y <= right_max_y
        and left_max_y >= right_min_y
    )


def bounds_overlap_ratio(
    bounds: dict[str, float] | None,
    viewport_bounds: BoundsTuple,
) -> float:
    if bounds is None:
        return 0.0

    cluster_min_x, cluster_max_x, cluster_min_y, cluster_max_y = scale_cluster_bounds(
        bounds
    )
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


def bounds_distance(
    bounds: dict[str, float] | None,
    viewport_bounds: BoundsTuple,
) -> float:
    if bounds is None:
        return float("inf")

    cluster_min_x, cluster_max_x, cluster_min_y, cluster_max_y = scale_cluster_bounds(
        bounds
    )
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
