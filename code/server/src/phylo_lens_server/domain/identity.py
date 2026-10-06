from __future__ import annotations

import json
from hashlib import sha256

from phylo_lens_server.domain.models import Dataset
from phylo_lens_server.domain.sfdp import SfdpOptions, resolve_sfdp_options

from .legacy_metadata import encode_dataset_annotations

LAYOUT_PIPELINE_VERSION = "rooted-hop-representation-lod-v2"
LOD_REPRESENTATION_GROWTH_FACTOR = 2.0


def layout_version_for_dataset(
    dataset: Dataset,
    sfdp_options: SfdpOptions | None = None,
) -> str:
    resolved_sfdp_options = resolve_sfdp_options(sfdp_options)
    payload = {
        "pipeline_version": LAYOUT_PIPELINE_VERSION,
        "lod_representation_growth_factor": LOD_REPRESENTATION_GROWTH_FACTOR,
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
                (*dataset.ancillary_schema, *dataset.summary_schema),
                key=lambda field: (field.key, field.type.value),
            )
        ],
        "metadata_by_node_id": encode_dataset_annotations(dataset),
        "ancillary_rows_by_node_id": {
            key: [dict(row) for row in rows]
            for key, rows in dataset.ancillary_rows_by_node_id.items()
        },
        "isolates_by_node_id": {
            node_id: [
                {"id": isolate.id, "metadata": dict(isolate.ancillary_data)}
                for isolate in isolates
            ]
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
