from __future__ import annotations

from math import ceil, sqrt

from phylo_lens_server.clustering.spatial import (
    BoundsTuple,
    bounds_intersect,
    spatial_bounds_to_tuple,
)
from phylo_lens_server.core.models import (
    SpatialBounds,
    SpatialIndexNode,
    SpatialLevelIndex,
)

DEFAULT_STR_NODE_CAPACITY = 16


def build_str_spatial_index(
    level: int,
    entries: list[tuple[str, SpatialBounds]],
    *,
    node_capacity: int = DEFAULT_STR_NODE_CAPACITY,
) -> SpatialLevelIndex:
    """Build a static STR-packed R-tree for one LoD level."""
    if not entries:
        return SpatialLevelIndex(level=level)

    capacity = max(2, node_capacity)
    nodes: list[SpatialIndexNode] = []
    current_layer = _pack_leaf_nodes(entries, nodes, capacity)

    while len(current_layer) > 1:
        current_layer = _pack_parent_nodes(current_layer, nodes, capacity)

    return SpatialLevelIndex(
        level=level,
        root_node_index=current_layer[0],
        nodes=nodes,
    )


def query_spatial_index(
    index: SpatialLevelIndex,
    viewport_bounds: BoundsTuple,
) -> set[str]:
    """Return cluster ids whose indexed bounds intersect the query viewport."""
    if index.root_node_index is None:
        return set()

    matches: set[str] = set()
    stack = [index.root_node_index]
    while stack:
        node_index = stack.pop()
        node = index.nodes[node_index]
        if not bounds_intersect(spatial_bounds_to_tuple(node.bounds), viewport_bounds):
            continue
        if node.child_node_indices:
            stack.extend(reversed(node.child_node_indices))
            continue

        matches.update(
            cluster_id
            for cluster_id in node.cluster_ids
            if _leaf_cluster_intersects(node, cluster_id, viewport_bounds)
        )

    return matches


def _pack_leaf_nodes(
    entries: list[tuple[str, SpatialBounds]],
    nodes: list[SpatialIndexNode],
    capacity: int,
) -> list[int]:
    node_indices: list[int] = []
    for tile in _str_tiles(entries, capacity, key_bounds=lambda entry: entry[1]):
        node_indices.append(
            _append_node(
                nodes,
                SpatialIndexNode(
                    bounds=_union_bounds([bounds for _, bounds in tile]),
                    cluster_ids=[cluster_id for cluster_id, _ in tile],
                    cluster_bounds_by_id=dict(tile),
                ),
            )
        )
    return node_indices


def _leaf_cluster_intersects(
    node: SpatialIndexNode,
    cluster_id: str,
    viewport_bounds: BoundsTuple,
) -> bool:
    bounds = node.cluster_bounds_by_id.get(cluster_id)
    if bounds is None:
        return True
    return bounds_intersect(spatial_bounds_to_tuple(bounds), viewport_bounds)


def _pack_parent_nodes(
    child_indices: list[int],
    nodes: list[SpatialIndexNode],
    capacity: int,
) -> list[int]:
    node_indices: list[int] = []
    for tile in _str_tiles(
        child_indices,
        capacity,
        key_bounds=lambda node_index: nodes[node_index].bounds,
    ):
        node_indices.append(
            _append_node(
                nodes,
                SpatialIndexNode(
                    bounds=_union_bounds(
                        [nodes[node_index].bounds for node_index in tile]
                    ),
                    child_node_indices=list(tile),
                ),
            )
        )
    return node_indices


def _str_tiles(
    items: list,
    capacity: int,
    *,
    key_bounds,
) -> list[list]:
    sorted_by_x = sorted(
        items,
        key=lambda item: (
            _center_x(key_bounds(item)),
            _center_y(key_bounds(item)),
        ),
    )
    leaf_count = ceil(len(items) / capacity)
    slice_count = max(1, ceil(sqrt(leaf_count)))
    slice_size = max(capacity, ceil(len(items) / slice_count))

    tiles: list[list] = []
    for offset in range(0, len(sorted_by_x), slice_size):
        x_slice = sorted_by_x[offset : offset + slice_size]
        sorted_by_y = sorted(
            x_slice,
            key=lambda item: (
                _center_y(key_bounds(item)),
                _center_x(key_bounds(item)),
            ),
        )
        for tile_offset in range(0, len(sorted_by_y), capacity):
            tiles.append(sorted_by_y[tile_offset : tile_offset + capacity])

    return tiles


def _append_node(
    nodes: list[SpatialIndexNode],
    node: SpatialIndexNode,
) -> int:
    nodes.append(node)
    return len(nodes) - 1


def _union_bounds(bounds_items: list[SpatialBounds]) -> SpatialBounds:
    return SpatialBounds(
        min_x=min(bounds.min_x for bounds in bounds_items),
        max_x=max(bounds.max_x for bounds in bounds_items),
        min_y=min(bounds.min_y for bounds in bounds_items),
        max_y=max(bounds.max_y for bounds in bounds_items),
    )


def _center_x(bounds: SpatialBounds) -> float:
    return (bounds.min_x + bounds.max_x) / 2


def _center_y(bounds: SpatialBounds) -> float:
    return (bounds.min_y + bounds.max_y) / 2
