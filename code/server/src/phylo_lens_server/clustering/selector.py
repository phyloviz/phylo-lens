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
ZOOM_DEPTH_MULTIPLIER = 3

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

    target_depth = _target_depth(query)
    max_nodes = query.max_nodes or min(len(dataset.nodes), DEFAULT_MAX_NODES_FALLBACK)

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
                cluster_id,
                focus_path_cluster_ids,
            )
        )
        cluster_id = frontier.pop(0)
        cluster = hierarchy.clusters[cluster_id]
        children = cluster.child_cluster_ids

        if not children or cluster.depth >= target_depth:
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
        cluster = hierarchy.clusters[cluster_id]
        node_id = cluster.representative_node_id
        if node_id is None:
            continue
        base_node = node_by_id[node_id]
        visible_nodes.append(
            CanonicalNode(
                id=base_node.id,
                x=cluster.centroid["x"] if cluster.centroid is not None else base_node.x,
                y=cluster.centroid["y"] if cluster.centroid is not None else base_node.y,
            )
        )
        visible_node_id_set.add(node_id)

    visible_edges = [
        edge
        for edge in dataset.edges
        if edge.source in visible_node_id_set and edge.target in visible_node_id_set
    ]

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


def _target_depth(query: VisibleSliceQuery) -> int:
    if query.lod_hint is not None:
        return query.lod_hint
    if query.zoom < ZOOM_OVERVIEW_THRESHOLD:
        return DEFAULT_OVERVIEW_DEPTH
    return max(1, int(round(query.zoom * ZOOM_DEPTH_MULTIPLIER)))


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
    cluster_id: str,
    focus_path_cluster_ids: set[str],
) -> tuple[int, int, str]:
    cluster = hierarchy.clusters[cluster_id]
    return (
        0 if cluster_id in focus_path_cluster_ids else 1,
        cluster.depth,
        cluster.representative_node_id or "",
    )
