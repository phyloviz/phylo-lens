from __future__ import annotations

from collections import defaultdict
from hashlib import sha1

from phylo_lens_server.core.models import CanonicalDataset, CanonicalEdge
from phylo_lens_server.prepared_layout.clustering import (
    ClusterIndex,
    MAX_CLUSTER_THRESHOLDS,
    distance_clusters,
    partition_for_threshold,
    prepared_cluster,
    representative_targets,
    sort_edges_by_distance,
    threshold_component_counts,
    threshold_for_representative_target,
)
from phylo_lens_server.prepared_layout.models import PreparedLayoutArtifacts

ERR_EMPTY_DATASET = "Prepared layout requires at least one node."
ERR_MISSING_DISTANCE = "Prepared layout requires every edge to carry a distance value."


class PreparedLayoutIngestError(ValueError):
    """Raised when a dataset cannot be prepared for materialized layout."""


def prepare_layout_artifacts(
    dataset: CanonicalDataset,
    *,
    max_thresholds: int = MAX_CLUSTER_THRESHOLDS,
) -> PreparedLayoutArtifacts:
    if not dataset.nodes:
        raise PreparedLayoutIngestError(ERR_EMPTY_DATASET)
    if any(edge.distance is None for edge in dataset.edges):
        raise PreparedLayoutIngestError(ERR_MISSING_DISTANCE)

    node_ids = tuple(sorted(node.id for node in dataset.nodes))
    cluster_index = ClusterIndex.build(dataset)
    thresholds = selected_distance_thresholds(
        node_ids,
        dataset.edges,
        max_thresholds,
    )
    clusters = distance_clusters(
        dataset,
        node_ids,
        thresholds,
        index=cluster_index,
    )
    clusters_by_id = {cluster.cluster_id: cluster for cluster in clusters}
    sorted_edges = sort_edges_by_distance(dataset.edges)
    for threshold in thresholds:
        partition = partition_for_threshold(
            dataset, node_ids, threshold, sorted_edges=sorted_edges
        )
        members_by_cluster_id: dict[str, list[str]] = defaultdict(list)
        for node_id, node_cluster_id in partition.items():
            members_by_cluster_id[node_cluster_id].append(node_id)
        for cluster_id in sorted(members_by_cluster_id):
            if cluster_id in clusters_by_id:
                continue
            member_node_ids = tuple(members_by_cluster_id[cluster_id])
            clusters_by_id[cluster_id] = prepared_cluster(
                dataset,
                threshold,
                member_node_ids,
                index=cluster_index,
            )
    clusters = sorted(
        clusters_by_id.values(),
        key=lambda cluster: (
            -cluster.member_count,
            cluster.threshold or 0.0,
            cluster.cluster_id,
        ),
    )
    return PreparedLayoutArtifacts(
        dataset=dataset,
        layout_version=layout_version_for_dataset(dataset),
        clusters=tuple(clusters),
    )


def selected_distance_thresholds(
    node_ids: tuple[str, ...],
    edges: list[CanonicalEdge],
    max_thresholds: int,
) -> tuple[float, ...]:
    unique_desc = sorted(
        {edge.distance for edge in edges if edge.distance is not None},
        reverse=True,
    )
    if not unique_desc:
        return (0.0,)
    if len(node_ids) <= 1:
        return (unique_desc[-1],)

    component_counts = threshold_component_counts(node_ids, edges, tuple(unique_desc))
    selected: list[float] = []
    for target in representative_targets(len(node_ids), max_thresholds):
        threshold = threshold_for_representative_target(component_counts, target)
        if threshold not in selected:
            selected.append(threshold)

    finest_threshold = unique_desc[-1]
    if finest_threshold not in selected:
        selected.append(finest_threshold)

    return tuple(sorted(selected[:max_thresholds], reverse=True))


def layout_version_for_dataset(dataset: CanonicalDataset) -> str:
    payload = "|".join(
        [
            dataset.dataset_id,
            ",".join(sorted(node.id for node in dataset.nodes)),
            ",".join(
                f"{edge.source}>{edge.target}:{edge.distance}"
                for edge in sorted(dataset.edges, key=lambda edge: edge.id)
            ),
        ]
    )
    return sha1(payload.encode("utf-8")).hexdigest()[:16]


__all__ = [
    "PreparedLayoutIngestError",
    "prepare_layout_artifacts",
    "selected_distance_thresholds",
    "layout_version_for_dataset",
    "partition_for_threshold",
    "representative_targets",
]
