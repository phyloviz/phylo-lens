from __future__ import annotations

from collections import deque
import logging

from phylo_lens_server.clustering.selection_policy import ClusterViewSelection
from phylo_lens_server.clustering.spatial import spatial_bounds_from_cluster_bounds
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

CLUSTER_PROXY_NODE_ID_PREFIX = "cluster_proxy:"
CLUSTER_SKELETON_EDGE_ID_PREFIX = "cluster_skeleton:"
MAX_TREE_PROXY_DEGREE = 3

logger = logging.getLogger(__name__)


def build_visible_slice_response(
    dataset: CanonicalDataset,
    hierarchy: ThresholdHierarchyIndex,
    query: VisibleSliceQuery,
    selection: ClusterViewSelection,
) -> VisibleSliceResponse:
    node_by_id = {node.id: node for node in dataset.nodes}
    visible_nodes, rendered_cluster_ids = build_visible_nodes(
        hierarchy=hierarchy,
        node_by_id=node_by_id,
        visible_order=selection.visible_order,
        expanded_cluster_ids=selection.expanded_cluster_ids,
    )
    visible_nodes, visible_edges = build_topology_preserving_visible_graph(
        dataset=dataset,
        hierarchy=hierarchy,
        rendered_cluster_ids=rendered_cluster_ids,
        visible_nodes=visible_nodes,
    )
    collapsed_clusters = [
        collapsed_cluster(hierarchy, cluster_id)
        for cluster_id in sorted(rendered_cluster_ids)
        if hierarchy.clusters[cluster_id].subtree_size > 1
        and cluster_id not in selection.expanded_cluster_ids
    ]
    log_visible_hubs(hierarchy, visible_nodes, visible_edges)

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
            global_bounds=hierarchy.global_bounds,
            focus_cluster_id=query.focus_cluster_id,
            focus_cluster_bounds=focus_cluster_bounds(
                hierarchy,
                query.focus_cluster_id,
            ),
        ),
    )


def build_visible_nodes(
    hierarchy: ThresholdHierarchyIndex,
    node_by_id: dict[str, CanonicalNode],
    visible_order: list[str],
    expanded_cluster_ids: set[str],
) -> tuple[list[CanonicalNode], set[str]]:
    visible_nodes: list[CanonicalNode] = []
    visible_node_ids: set[str] = set()
    rendered_cluster_ids: set[str] = set()

    for cluster_id in visible_order:
        is_cluster_proxy = is_cluster_proxy_cluster(
            hierarchy,
            cluster_id,
            expanded_cluster_ids,
        )
        if not is_cluster_proxy and hierarchy.clusters[cluster_id].subtree_size > 1:
            continue

        if append_cluster_node(
            visible_nodes,
            visible_node_ids,
            hierarchy,
            node_by_id,
            cluster_id,
            is_cluster_proxy,
        ):
            rendered_cluster_ids.add(cluster_id)

    return visible_nodes, rendered_cluster_ids


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

    visible_node_id = cluster_proxy_node_id(cluster_id) if is_cluster_proxy else node_id
    if visible_node_id in visible_node_ids:
        return False

    base_node = node_by_id[node_id]
    x = base_node.x
    y = base_node.y
    if is_cluster_proxy and cluster.centroid is not None:
        x = cluster.centroid["x"]
        y = cluster.centroid["y"]

    visible_nodes.append(
        CanonicalNode(
            id=visible_node_id,
            x=x,
            y=y,
            cluster_id=cluster.cluster_id,
            is_cluster_proxy=is_cluster_proxy,
            subtree_size=cluster.subtree_size if is_cluster_proxy else None,
            leaf_count=cluster.subtree_size if is_cluster_proxy else None,
        )
    )
    visible_node_ids.add(visible_node_id)
    return True


def collapsed_cluster(
    hierarchy: ThresholdHierarchyIndex,
    cluster_id: str,
) -> CollapsedCluster:
    cluster = hierarchy.clusters[cluster_id]
    return CollapsedCluster(
        cluster_id=cluster.cluster_id,
        representative_node_id=cluster.representative_node_id,
        subtree_size=cluster.subtree_size,
        centroid=cluster.centroid,
    )


def build_topology_preserving_visible_graph(
    dataset: CanonicalDataset,
    hierarchy: ThresholdHierarchyIndex,
    rendered_cluster_ids: set[str],
    visible_nodes: list[CanonicalNode],
) -> tuple[list[CanonicalNode], list[CanonicalEdge]]:
    node_by_id = {node.id: node for node in dataset.nodes}
    cluster_order = {
        node.cluster_id: index
        for index, node in enumerate(visible_nodes)
        if node.cluster_id is not None
    }
    cluster_id_by_member_node_id = {
        member_node_id: cluster_id
        for cluster_id in rendered_cluster_ids
        for member_node_id in hierarchy.clusters[cluster_id].member_node_ids
    }
    adjacency = dataset_adjacency(dataset)
    visible_node_by_id = {node.id: node for node in visible_nodes}
    skeleton_edges: list[CanonicalEdge] = []
    skeleton_cluster_ids: set[str] = set()

    for visible_node in list(visible_nodes):
        cluster_id = visible_node.cluster_id
        if visible_node.is_cluster_proxy is not True or cluster_id is None:
            continue

        cluster = hierarchy.clusters[cluster_id]
        boundary_edge_count = cluster_boundary_edge_count(
            cluster_id,
            cluster.member_node_ids,
            cluster_id_by_member_node_id,
            adjacency,
        )
        if boundary_edge_count <= MAX_TREE_PROXY_DEGREE:
            continue

        boundary_node_ids = cluster_boundary_node_ids(
            cluster_id,
            cluster.member_node_ids,
            cluster_id_by_member_node_id,
            adjacency,
        )
        skeleton_node_ids, cluster_skeleton_edges = compressed_cluster_skeleton(
            cluster_id,
            cluster.member_node_ids,
            boundary_node_ids,
            adjacency,
        )
        visible_node_by_id.pop(visible_node.id, None)
        skeleton_cluster_ids.add(cluster_id)
        skeleton_edges.extend(cluster_skeleton_edges)

        for node_id in skeleton_node_ids:
            visible_node_by_id[node_id] = node_by_id[node_id].model_copy(
                update={
                    "cluster_id": cluster_id,
                    "is_cluster_proxy": False,
                    "is_cluster_skeleton": True,
                }
            )

    projection = topology_preserving_node_projection(
        dataset,
        hierarchy,
        rendered_cluster_ids,
        list(visible_node_by_id.values()),
        skeleton_cluster_ids,
    )
    edge_by_pair: dict[tuple[str, str], CanonicalEdge] = {}

    for edge in dataset.edges:
        source = projection.get(edge.source)
        target = projection.get(edge.target)
        if source is None or target is None or source == target:
            continue

        source, target = sorted((source, target))
        candidate = edge.model_copy(update={"source": source, "target": target})
        current = edge_by_pair.get((source, target))
        if current is None or edge_distance_key(candidate) < edge_distance_key(current):
            edge_by_pair[(source, target)] = candidate

    for edge in skeleton_edges:
        source, target = sorted((edge.source, edge.target))
        edge_by_pair[(source, target)] = edge.model_copy(
            update={"source": source, "target": target}
        )

    return (
        sorted(
            visible_node_by_id.values(),
            key=lambda node: (
                cluster_order.get(node.cluster_id, len(cluster_order)),
                node.id,
            ),
        ),
        sorted(edge_by_pair.values(), key=lambda edge: (edge.source, edge.target)),
    )


def dataset_adjacency(
    dataset: CanonicalDataset,
) -> dict[str, list[tuple[str, CanonicalEdge]]]:
    adjacency: dict[str, list[tuple[str, CanonicalEdge]]] = {
        node.id: [] for node in dataset.nodes
    }
    for edge in dataset.edges:
        adjacency[edge.source].append((edge.target, edge))
        adjacency[edge.target].append((edge.source, edge))
    return adjacency


def cluster_boundary_node_ids(
    cluster_id: str,
    member_node_ids: list[str],
    cluster_id_by_member_node_id: dict[str, str],
    adjacency: dict[str, list[tuple[str, CanonicalEdge]]],
) -> set[str]:
    return {
        node_id
        for node_id in member_node_ids
        if any(
            cluster_id_by_member_node_id.get(neighbor_id) != cluster_id
            for neighbor_id, _edge in adjacency[node_id]
        )
    }


def cluster_boundary_edge_count(
    cluster_id: str,
    member_node_ids: list[str],
    cluster_id_by_member_node_id: dict[str, str],
    adjacency: dict[str, list[tuple[str, CanonicalEdge]]],
) -> int:
    return sum(
        cluster_id_by_member_node_id.get(neighbor_id) != cluster_id
        for node_id in member_node_ids
        for neighbor_id, _edge in adjacency[node_id]
    )


def compressed_cluster_skeleton(
    cluster_id: str,
    member_node_ids: list[str],
    boundary_node_ids: set[str],
    adjacency: dict[str, list[tuple[str, CanonicalEdge]]],
) -> tuple[set[str], list[CanonicalEdge]]:
    members = set(member_node_ids)
    active_node_ids = set(member_node_ids)
    active_degree = {
        node_id: sum(neighbor_id in members for neighbor_id, _edge in adjacency[node_id])
        for node_id in member_node_ids
    }
    prunable = deque(
        node_id
        for node_id in member_node_ids
        if active_degree[node_id] <= 1 and node_id not in boundary_node_ids
    )

    while prunable:
        node_id = prunable.popleft()
        if node_id not in active_node_ids or node_id in boundary_node_ids:
            continue

        active_node_ids.remove(node_id)
        for neighbor_id, _edge in adjacency[node_id]:
            if neighbor_id not in active_node_ids:
                continue
            active_degree[neighbor_id] -= 1
            if (
                active_degree[neighbor_id] <= 1
                and neighbor_id not in boundary_node_ids
            ):
                prunable.append(neighbor_id)

    retained_node_ids = {
        node_id
        for node_id in active_node_ids
        if node_id in boundary_node_ids
        or active_neighbor_count(node_id, active_node_ids, adjacency) != 2
    }
    skeleton_edges: list[CanonicalEdge] = []
    traversed_segments: set[frozenset[str]] = set()

    for source_id in sorted(retained_node_ids):
        for neighbor_id, first_edge in adjacency[source_id]:
            if neighbor_id not in active_node_ids:
                continue
            first_segment = frozenset((source_id, neighbor_id))
            if first_segment in traversed_segments:
                continue

            traversed_segments.add(first_segment)
            previous_id = source_id
            current_id = neighbor_id
            path_edges = [first_edge]

            while current_id not in retained_node_ids:
                next_steps = [
                    (candidate_id, edge)
                    for candidate_id, edge in adjacency[current_id]
                    if candidate_id in active_node_ids and candidate_id != previous_id
                ]
                if not next_steps:
                    break
                next_id, next_edge = next_steps[0]
                traversed_segments.add(frozenset((current_id, next_id)))
                previous_id, current_id = current_id, next_id
                path_edges.append(next_edge)

            if current_id == source_id or current_id not in retained_node_ids:
                continue

            skeleton_edges.append(
                CanonicalEdge(
                    id=(
                        f"{CLUSTER_SKELETON_EDGE_ID_PREFIX}{cluster_id}:"
                        f"{source_id}:{current_id}"
                    ),
                    source=source_id,
                    target=current_id,
                    distance=sum((edge.distance or 0.0) for edge in path_edges),
                )
            )

    return retained_node_ids, skeleton_edges


def active_neighbor_count(
    node_id: str,
    active_node_ids: set[str],
    adjacency: dict[str, list[tuple[str, CanonicalEdge]]],
) -> int:
    return sum(
        neighbor_id in active_node_ids for neighbor_id, _edge in adjacency[node_id]
    )


def topology_preserving_node_projection(
    dataset: CanonicalDataset,
    hierarchy: ThresholdHierarchyIndex,
    rendered_cluster_ids: set[str],
    visible_nodes: list[CanonicalNode],
    skeleton_cluster_ids: set[str],
) -> dict[str, str]:
    projection = {
        node.id: node.id
        for node in visible_nodes
        if node.is_cluster_proxy is not True
    }
    proxy_node_id_by_cluster_id = {
        node.cluster_id: node.id
        for node in visible_nodes
        if node.is_cluster_proxy is True and node.cluster_id is not None
    }

    for cluster_id in rendered_cluster_ids:
        if cluster_id in skeleton_cluster_ids:
            continue
        proxy_node_id = proxy_node_id_by_cluster_id.get(cluster_id)
        if proxy_node_id is None:
            continue
        for member_node_id in hierarchy.clusters[cluster_id].member_node_ids:
            projection.setdefault(member_node_id, proxy_node_id)

    return {
        node.id: projection[node.id]
        for node in dataset.nodes
        if node.id in projection
    }


def edge_distance_key(edge: CanonicalEdge) -> tuple[float, str]:
    return (
        edge.distance if edge.distance is not None else float("inf"),
        edge.id,
    )


def cluster_proxy_node_id(cluster_id: str) -> str:
    return f"{CLUSTER_PROXY_NODE_ID_PREFIX}{cluster_id}"


def is_cluster_proxy_cluster(
    hierarchy: ThresholdHierarchyIndex,
    cluster_id: str,
    expanded_cluster_ids: set[str],
) -> bool:
    cluster = hierarchy.clusters[cluster_id]
    return cluster.subtree_size > 1 and cluster_id not in expanded_cluster_ids


def lod_level(
    hierarchy: ThresholdHierarchyIndex,
    rendered_cluster_ids: set[str],
) -> int:
    if not rendered_cluster_ids:
        return 0
    return max(
        hierarchy.clusters[cluster_id].distance_threshold_level
        for cluster_id in rendered_cluster_ids
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


def log_visible_hubs(
    hierarchy: ThresholdHierarchyIndex,
    visible_nodes: list[CanonicalNode],
    visible_edges: list[CanonicalEdge],
) -> None:
    if not visible_nodes:
        return

    degree_by_node_id = {node.id: 0 for node in visible_nodes}
    for edge in visible_edges:
        degree_by_node_id[edge.source] = degree_by_node_id.get(edge.source, 0) + 1
        degree_by_node_id[edge.target] = degree_by_node_id.get(edge.target, 0) + 1

    node_by_id = {node.id: node for node in visible_nodes}
    for rank, node_id in enumerate(
        sorted(
            degree_by_node_id,
            key=lambda candidate: (
                degree_by_node_id[candidate],
                node_by_id[candidate].is_cluster_proxy is True,
                candidate,
            ),
            reverse=True,
        )[:10],
        start=1,
    ):
        node = node_by_id[node_id]
        cluster = (
            hierarchy.clusters.get(node.cluster_id)
            if node.cluster_id is not None
            else None
        )
        logger.debug(
            "visible_slice_hub rank=%s id=%s degree=%s is_cluster_proxy=%s "
            "subtree_size=%s distance_threshold_level=%s",
            rank,
            node_id,
            degree_by_node_id[node_id],
            node.is_cluster_proxy is True,
            node.subtree_size,
            cluster.distance_threshold_level if cluster is not None else None,
        )
