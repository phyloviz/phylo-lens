from __future__ import annotations

import json
from hashlib import sha256

from phylo_lens_server.domain.models import CanonicalDataset, CanonicalEdge
from phylo_lens_server.pipeline.clustering import (
    MAX_CLUSTER_THRESHOLDS,
    ClusterIndex,
    components_by_threshold,
    partition_for_threshold,
    prepared_cluster,
    representative_targets,
    sort_edges_by_distance,
    threshold_component_counts,
    threshold_for_representative_target,
)
from phylo_lens_server.pipeline.models import PreparedLayoutArtifacts
from phylo_lens_server.pipeline.sfdp import SfdpOptions, resolve_sfdp_options

ERR_EMPTY_DATASET = "Prepared layout requires at least one node."
ERR_MISSING_DISTANCE = "Prepared layout requires every edge to carry a distance value."
LAYOUT_PIPELINE_VERSION = "layout-pipeline-v1"


class PreparedLayoutIngestError(ValueError):
    """Raised when a dataset cannot be prepared for materialized layout."""


def prepare_layout_artifacts(
    dataset: CanonicalDataset,
    *,
    max_thresholds: int = MAX_CLUSTER_THRESHOLDS,
    sfdp_options: SfdpOptions | None = None,
) -> PreparedLayoutArtifacts:
    if not dataset.nodes:
        raise PreparedLayoutIngestError(ERR_EMPTY_DATASET)
    if any(edge.distance is None for edge in dataset.edges):
        raise PreparedLayoutIngestError(ERR_MISSING_DISTANCE)

    resolved_sfdp_options = resolve_sfdp_options(sfdp_options)
    node_ids = tuple(sorted(node.id for node in dataset.nodes))
    cluster_index = ClusterIndex.build(dataset)
    sorted_edges = sort_edges_by_distance(dataset.edges)
    thresholds = selected_distance_thresholds(
        node_ids,
        dataset.edges,
        max_thresholds,
        sorted_edges=sorted_edges,
    )
    components = components_by_threshold(
        node_ids,
        dataset.edges,
        thresholds,
        sorted_edges=sorted_edges,
    )
    clusters_by_id = {}
    for threshold in thresholds:
        for member_node_ids in components[threshold]:
            cluster = prepared_cluster(
                dataset,
                threshold,
                member_node_ids,
                index=cluster_index,
            )
            cluster_id = cluster.cluster_id
            if cluster_id in clusters_by_id:
                continue
            clusters_by_id[cluster_id] = cluster
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
        layout_version=layout_version_for_dataset(dataset, resolved_sfdp_options),
        clusters=tuple(clusters),
        sfdp_options=resolved_sfdp_options,
    )


def selected_distance_thresholds(
    node_ids: tuple[str, ...],
    edges: list[CanonicalEdge],
    max_thresholds: int,
    *,
    sorted_edges: tuple[CanonicalEdge, ...] | None = None,
) -> tuple[float, ...]:
    unique_desc = sorted(
        {edge.distance for edge in edges if edge.distance is not None},
        reverse=True,
    )
    if not unique_desc:
        return (0.0,)
    if len(node_ids) <= 1:
        return (unique_desc[-1],)

    component_counts = threshold_component_counts(
        node_ids,
        edges,
        tuple(unique_desc),
        sorted_edges=sorted_edges,
    )
    selected: list[float] = []
    for target in representative_targets(len(node_ids), max_thresholds):
        threshold = threshold_for_representative_target(component_counts, target)
        if threshold not in selected:
            selected.append(threshold)

    finest_threshold = unique_desc[-1]
    if finest_threshold not in selected:
        selected.append(finest_threshold)

    return tuple(sorted(selected[:max_thresholds], reverse=True))


def layout_version_for_dataset(
    dataset: CanonicalDataset,
    sfdp_options: SfdpOptions | None = None,
) -> str:
    resolved_sfdp_options = resolve_sfdp_options(sfdp_options)
    payload = {
        "pipeline_version": LAYOUT_PIPELINE_VERSION,
        "sfdp_options": resolved_sfdp_options.model_dump(
            mode="json",
            by_alias=True,
        ),
        "dataset_id": dataset.dataset_id,
        "nodes": [
            node.model_dump(mode="json", exclude_none=True)
            for node in sorted(dataset.nodes, key=lambda node: node.id)
        ],
        "edges": [
            edge.model_dump(mode="json", exclude_none=True)
            for edge in sorted(
                dataset.edges,
                key=lambda edge: (edge.id, edge.source, edge.target, edge.distance),
            )
        ],
        "metadata_schema": [
            field.model_dump(mode="json")
            for field in sorted(
                dataset.metadata_schema,
                key=lambda field: (field.key, field.type.value),
            )
        ],
        "metadata_by_node_id": dataset.metadata_by_node_id,
        "ancillary_rows_by_node_id": dataset.ancillary_rows_by_node_id,
        "source": {
            "format": dataset.source.format.value,
            "provenance": dataset.source.provenance,
        },
    }
    canonical = json.dumps(
        payload,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=True,
    )
    return sha256(canonical.encode("utf-8")).hexdigest()[:16]


__all__ = [
    "LAYOUT_PIPELINE_VERSION",
    "PreparedLayoutIngestError",
    "layout_version_for_dataset",
    "partition_for_threshold",
    "prepare_layout_artifacts",
    "representative_targets",
    "selected_distance_thresholds",
]
