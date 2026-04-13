from __future__ import annotations

from collections import deque

from phylo_lens_server.core.models import (
    CanonicalDataset,
    CanonicalEdge,
    CanonicalNode,
    CollapsedCluster,
    HierarchyIndex,
    VisibleSliceQuery,
    VisibleSliceResponse,
    VisibleSliceViewMeta,
)

DEFAULT_OVERVIEW_DEPTH = 0
DEFAULT_MAX_NODES_FALLBACK = 10_000

ERR_SELECTOR_DATASET_MISMATCH = (
    "Visible-slice query dataset '{query_dataset_id}' does not match hierarchy/dataset '{dataset_id}'."
)


class VisibleSliceSelectionError(ValueError):
    """Raised when a visible slice cannot be selected from the given inputs."""


def select_visible_slice(
    dataset: CanonicalDataset,
    hierarchy: HierarchyIndex,
    query: VisibleSliceQuery,
) -> VisibleSliceResponse:
    """Select a deterministic visible slice from a hierarchy and runtime query."""
    if dataset.dataset_id != hierarchy.dataset_id or query.dataset_id != dataset.dataset_id:
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

    queue = deque([hierarchy.root_cluster_id])
    while queue:
        cluster_id = queue.popleft()
        cluster = hierarchy.clusters[cluster_id]
        children = cluster.child_cluster_ids

        if not children or cluster.depth >= target_depth:
            continue

        expansion_cost = len(children)
        if len(visible_cluster_ids) + expansion_cost > max_nodes:
            continue

        expanded_cluster_ids.add(cluster_id)
        for child_cluster_id in children:
            if child_cluster_id in visible_cluster_ids:
                continue
            visible_cluster_ids.add(child_cluster_id)
            visible_order.append(child_cluster_id)
            queue.append(child_cluster_id)

    visible_node_ids = [
        hierarchy.clusters[cluster_id].representative_node_id
        for cluster_id in visible_order
        if hierarchy.clusters[cluster_id].representative_node_id is not None
    ]
    visible_node_id_set = set(visible_node_ids)

    node_by_id = {node.id: node for node in dataset.nodes}
    visible_nodes = [node_by_id[node_id] for node_id in visible_node_ids]

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
            if child_cluster_id in visible_cluster_ids or child_cluster.subtree_size <= 1:
                continue
            collapsed_clusters.append(
                CollapsedCluster(
                    cluster_id=child_cluster.cluster_id,
                    representative_node_id=child_cluster.representative_node_id,
                    subtree_size=child_cluster.subtree_size,
                    centroid=child_cluster.centroid,
                )
            )

    lod_level = max(hierarchy.clusters[cluster_id].depth for cluster_id in visible_order)

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
    if query.zoom < 1:
        return DEFAULT_OVERVIEW_DEPTH
    return int(query.zoom)
