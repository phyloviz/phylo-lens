from __future__ import annotations

from typing import Any

from phylo_lens_server.pipeline.models import PreparedLayoutResult


def prepare_result_payload(
    result: PreparedLayoutResult,
    submit_warnings: tuple[str, ...],
) -> dict[str, Any]:
    distinct_thresholds = {
        cluster.threshold
        for cluster in result.artifacts.clusters
        if cluster.threshold is not None
    }
    return {
        "dataset_id": result.artifacts.dataset.dataset_id,
        "layout_version": result.artifacts.layout_version,
        "node_count": len(result.artifacts.dataset.nodes),
        "edge_count": len(result.artifacts.dataset.edges),
        "cluster_count": len(result.artifacts.clusters),
        "lod_tier_count": max(len(distinct_thresholds), 1),
        "layout_status": result.layout_status,
        "warnings": list(submit_warnings),
    }
