from __future__ import annotations

import json
from hashlib import sha256

from phylo_lens_server.domain.models import CanonicalDataset
from phylo_lens_server.pipeline.clustering import (
    clusters_at_depth,
    rooted_depths,
    selected_depths,
    tree_adjacency,
)
from phylo_lens_server.pipeline.models import PreparedLayoutArtifacts
from phylo_lens_server.pipeline.sfdp import SfdpOptions, resolve_sfdp_options

ERR_EMPTY_DATASET = "Prepared layout requires at least one node."
ERR_MISSING_DISTANCE = "Prepared layout requires every edge to carry a distance value."
LAYOUT_PIPELINE_VERSION = "rooted-hop-lod-v1"


class PreparedLayoutIngestError(ValueError):
    """Raised when a dataset cannot be prepared for materialized layout."""


def prepare_layout_artifacts(
    dataset: CanonicalDataset,
    *,
    sfdp_options: SfdpOptions | None = None,
) -> PreparedLayoutArtifacts:
    if not dataset.nodes:
        raise PreparedLayoutIngestError(ERR_EMPTY_DATASET)
    if any(edge.distance is None for edge in dataset.edges):
        raise PreparedLayoutIngestError(ERR_MISSING_DISTANCE)

    resolved_sfdp_options = resolve_sfdp_options(sfdp_options)
    neighbors = tree_adjacency(dataset)
    depths = rooted_depths(neighbors, dataset.technical_roots)
    cuts = selected_depths(max(depths.values()))
    clusters = tuple(
        cluster
        for lod_level, hop_depth in enumerate(cuts)
        for cluster in clusters_at_depth(neighbors, depths, hop_depth, lod_level)
    )
    return PreparedLayoutArtifacts(
        dataset=dataset,
        layout_version=layout_version_for_dataset(dataset, resolved_sfdp_options),
        clusters=clusters,
        sfdp_options=resolved_sfdp_options,
    )


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
        "technical_roots": dataset.technical_roots,
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
        "isolates_by_node_id": {
            node_id: [isolate.model_dump(by_alias=True) for isolate in isolates]
            for node_id, isolates in sorted(dataset.isolates_by_node_id.items())
        },
        "source": {
            "format": dataset.source.format.value,
            "provenance": dataset.source.provenance,
            "rooting_strategy": dataset.source.rooting_strategy,
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
    "prepare_layout_artifacts",
]
