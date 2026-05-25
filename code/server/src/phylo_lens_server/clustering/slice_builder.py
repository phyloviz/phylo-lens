from __future__ import annotations

from phylo_lens_server.clustering.selection_policy import (
    ClusterViewSelection,
    is_synthetic_root,
)
from phylo_lens_server.clustering.spatial import (
    spatial_bounds_from_cluster_bounds,
)
from phylo_lens_server.core.models import (
    CanonicalDataset,
    CanonicalEdge,
    CanonicalNode,
    CollapsedCluster,
    SpatialBounds,
    ThresholdHierarchyIndex,
    VisibleSliceQuery,
    VisibleSliceResponse,
    VisibleSliceViewMeta,
)


def build_visible_slice_response(
    dataset: CanonicalDataset,
    hierarchy: ThresholdHierarchyIndex,
    query: VisibleSliceQuery,
    selection: ClusterViewSelection,
) -> VisibleSliceResponse:
    node_by_id = {node.id: node for node in dataset.nodes}

    visible_nodes, visible_node_ids, rendered_cluster_ids = build_visible_nodes(
        hierarchy=hierarchy,
        node_by_id=node_by_id,
        visible_order=selection.visible_order,
        expanded_cluster_ids=selection.expanded_cluster_ids,
    )

    collapsed_clusters = build_collapsed_clusters(
        hierarchy=hierarchy,
        visible_order=selection.visible_order,
        expanded_cluster_ids=selection.expanded_cluster_ids,
        rendered_cluster_ids=rendered_cluster_ids,
        visible_nodes=visible_nodes,
        visible_node_ids=visible_node_ids,
        node_by_id=node_by_id,
    )

    visible_edges = build_visible_edges(
        hierarchy=hierarchy,
        visible_order=selection.visible_order,
        rendered_cluster_ids=rendered_cluster_ids,
        visible_node_ids=visible_node_ids,
    )

    return VisibleSliceResponse(
        dataset_id=dataset.dataset_id,
        lod_level=lod_level(hierarchy, rendered_cluster_ids),
        nodes=visible_nodes,
        edges=visible_edges,
        collapsed_clusters=collapsed_clusters,
        view_meta=VisibleSliceViewMeta(
            viewport=query.viewport,
            zoom=query.zoom,
            returned_node_count=len(visible_nodes),
            returned_edge_count=len(visible_edges),
            global_bounds=global_bounds(hierarchy),
            focus_cluster_id=query.focus_cluster_id,
            focus_cluster_bounds=focus_cluster_bounds(
                hierarchy, query.focus_cluster_id
            ),
        ),
    )


def build_visible_nodes(
    hierarchy: ThresholdHierarchyIndex,
    node_by_id: dict[str, CanonicalNode],
    visible_order: list[str],
    expanded_cluster_ids: set[str],
) -> tuple[list[CanonicalNode], set[str], set[str]]:
    visible_nodes: list[CanonicalNode] = []
    visible_node_ids: set[str] = set()
    rendered_cluster_ids: set[str] = set()

    for cluster_id in visible_order:
        if is_synthetic_root(hierarchy, cluster_id):
            continue

        was_appended = append_cluster_node(
            visible_nodes=visible_nodes,
            visible_node_ids=visible_node_ids,
            hierarchy=hierarchy,
            node_by_id=node_by_id,
            cluster_id=cluster_id,
            is_cluster_proxy=is_cluster_proxy_cluster(
                hierarchy,
                cluster_id,
                expanded_cluster_ids,
            ),
        )

        if was_appended:
            rendered_cluster_ids.add(cluster_id)

    return visible_nodes, visible_node_ids, rendered_cluster_ids


def build_collapsed_clusters(
    hierarchy: ThresholdHierarchyIndex,
    visible_order: list[str],
    expanded_cluster_ids: set[str],
    rendered_cluster_ids: set[str],
    visible_nodes: list[CanonicalNode],
    visible_node_ids: set[str],
    node_by_id: dict[str, CanonicalNode],
) -> list[CollapsedCluster]:
    collapsed_clusters: list[CollapsedCluster] = []

    for cluster_id in visible_order:
        if should_skip_collapsed_parent(
            hierarchy=hierarchy,
            cluster_id=cluster_id,
            expanded_cluster_ids=expanded_cluster_ids,
            rendered_cluster_ids=rendered_cluster_ids,
        ):
            continue

        for child_cluster_id in hierarchy.clusters[cluster_id].child_cluster_ids:
            maybe_append_collapsed_child(
                hierarchy=hierarchy,
                node_by_id=node_by_id,
                child_cluster_id=child_cluster_id,
                collapsed_clusters=collapsed_clusters,
                rendered_cluster_ids=rendered_cluster_ids,
                visible_nodes=visible_nodes,
                visible_node_ids=visible_node_ids,
            )

    return collapsed_clusters


def should_skip_collapsed_parent(
    hierarchy: ThresholdHierarchyIndex,
    cluster_id: str,
    expanded_cluster_ids: set[str],
    rendered_cluster_ids: set[str],
) -> bool:
    if is_synthetic_root(hierarchy, cluster_id):
        return True

    if cluster_id in expanded_cluster_ids:
        return True

    return cluster_id in rendered_cluster_ids and is_cluster_proxy_cluster(
        hierarchy, cluster_id, expanded_cluster_ids
    )


def maybe_append_collapsed_child(
    hierarchy: ThresholdHierarchyIndex,
    node_by_id: dict[str, CanonicalNode],
    child_cluster_id: str,
    collapsed_clusters: list[CollapsedCluster],
    rendered_cluster_ids: set[str],
    visible_nodes: list[CanonicalNode],
    visible_node_ids: set[str],
) -> None:
    child_cluster = hierarchy.clusters[child_cluster_id]

    if child_cluster.subtree_size <= 1:
        return

    if child_cluster_id in rendered_cluster_ids:
        return

    collapsed_clusters.append(
        CollapsedCluster(
            cluster_id=child_cluster.cluster_id,
            representative_node_id=child_cluster.representative_node_id,
            subtree_size=child_cluster.subtree_size,
            centroid=child_cluster.centroid,
        )
    )

    if child_cluster.representative_node_id is None:
        return

    if child_cluster.representative_node_id in visible_node_ids:
        return

    was_appended = append_cluster_node(
        visible_nodes=visible_nodes,
        visible_node_ids=visible_node_ids,
        hierarchy=hierarchy,
        node_by_id=node_by_id,
        cluster_id=child_cluster_id,
        is_cluster_proxy=True,
    )

    if was_appended:
        rendered_cluster_ids.add(child_cluster_id)


def append_cluster_node(
    visible_nodes: list[CanonicalNode],
    visible_node_ids: set[str],
    hierarchy: ThresholdHierarchyIndex,
    node_by_id: dict[str, CanonicalNode],
    cluster_id: str,
    is_cluster_proxy: bool,
) -> bool:
    cluster = hierarchy.clusters[cluster_id]
    node_id = cluster.representative_node_id

    if node_id is None:
        return False

    if node_id in visible_node_ids:
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

    visible_node_ids.add(node_id)

    return True


def build_visible_edges(
    hierarchy: ThresholdHierarchyIndex,
    visible_order: list[str],
    rendered_cluster_ids: set[str],
    visible_node_ids: set[str],
) -> list[CanonicalEdge]:
    visible_edges: list[CanonicalEdge] = []
    visible_edge_pairs: set[tuple[str, str]] = set()

    for cluster_id in visible_order:
        append_visible_cluster_edges(
            hierarchy=hierarchy,
            cluster_id=cluster_id,
            rendered_cluster_ids=rendered_cluster_ids,
            visible_node_ids=visible_node_ids,
            visible_edges=visible_edges,
            visible_edge_pairs=visible_edge_pairs,
        )

    return visible_edges


def append_visible_cluster_edges(
    hierarchy: ThresholdHierarchyIndex,
    cluster_id: str,
    rendered_cluster_ids: set[str],
    visible_node_ids: set[str],
    visible_edges: list[CanonicalEdge],
    visible_edge_pairs: set[tuple[str, str]],
) -> None:
    if is_synthetic_root(hierarchy, cluster_id):
        return

    if cluster_id not in rendered_cluster_ids:
        return

    cluster = hierarchy.clusters[cluster_id]
    parent_node_id = cluster.representative_node_id

    if parent_node_id is None or parent_node_id not in visible_node_ids:
        return

    for child_cluster_id in cluster.child_cluster_ids:
        maybe_append_visible_edge(
            hierarchy=hierarchy,
            parent_cluster_id=cluster.cluster_id,
            parent_node_id=parent_node_id,
            child_cluster_id=child_cluster_id,
            rendered_cluster_ids=rendered_cluster_ids,
            visible_node_ids=visible_node_ids,
            visible_edges=visible_edges,
            visible_edge_pairs=visible_edge_pairs,
        )


def maybe_append_visible_edge(
    hierarchy: ThresholdHierarchyIndex,
    parent_cluster_id: str,
    parent_node_id: str,
    child_cluster_id: str,
    rendered_cluster_ids: set[str],
    visible_node_ids: set[str],
    visible_edges: list[CanonicalEdge],
    visible_edge_pairs: set[tuple[str, str]],
) -> None:
    if child_cluster_id not in rendered_cluster_ids:
        return

    child_cluster = hierarchy.clusters[child_cluster_id]
    child_node_id = child_cluster.representative_node_id

    if child_node_id is None or child_node_id not in visible_node_ids:
        return

    if parent_node_id == child_node_id:
        return

    edge_pair = (parent_node_id, child_node_id)

    if edge_pair in visible_edge_pairs:
        return

    visible_edge_pairs.add(edge_pair)

    visible_edges.append(
        CanonicalEdge(
            id=f"hier_{parent_cluster_id}_{child_cluster.cluster_id}",
            source=parent_node_id,
            target=child_node_id,
        )
    )


def lod_level(
    hierarchy: ThresholdHierarchyIndex,
    rendered_cluster_ids: set[str],
) -> int:
    non_synthetic_cluster_ids = [
        cluster_id
        for cluster_id in rendered_cluster_ids
        if not is_synthetic_root(hierarchy, cluster_id)
    ]

    if not non_synthetic_cluster_ids:
        return 0

    return max(
        hierarchy.clusters[cluster_id].distance_threshold_level
        for cluster_id in non_synthetic_cluster_ids
    )


def is_cluster_proxy_cluster(
    hierarchy: ThresholdHierarchyIndex,
    cluster_id: str,
    expanded_cluster_ids: set[str],
) -> bool:
    cluster = hierarchy.clusters[cluster_id]
    return cluster.subtree_size > 1 and cluster_id not in expanded_cluster_ids


def global_bounds(hierarchy: ThresholdHierarchyIndex) -> SpatialBounds | None:
    if hierarchy.global_bounds is not None:
        return hierarchy.global_bounds

    return spatial_bounds_from_cluster_bounds(
        hierarchy.clusters[hierarchy.root_cluster_id].bounds
    )


def focus_cluster_bounds(
    hierarchy: ThresholdHierarchyIndex,
    focus_cluster_id: str | None,
) -> SpatialBounds | None:
    if focus_cluster_id is None:
        return None

    cluster = hierarchy.clusters.get(focus_cluster_id)

    if cluster is None:
        return None

    return spatial_bounds_from_cluster_bounds(cluster.bounds)
