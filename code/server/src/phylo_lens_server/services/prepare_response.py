from __future__ import annotations

from phylo_lens_server.http.graph.schemas import GraphPrepareResponse
from phylo_lens_server.pipeline.layout import (
    LAYOUT_DEGRADED_SFDP_FAILED,
    LAYOUT_DEGRADED_SFDP_INCOMPLETE,
    LAYOUT_DEGRADED_SFDP_MISSING,
)
from phylo_lens_server.pipeline.models import PreparedLayoutResult

_LAYOUT_DEGRADED_WARNINGS = {
    LAYOUT_DEGRADED_SFDP_MISSING: (
        "Graphviz 'sfdp' was unavailable; produced a circular fallback layout "
        "instead of a force-directed one. Install Graphviz and re-prepare for a "
        "topology-aware layout."
    ),
    LAYOUT_DEGRADED_SFDP_FAILED: (
        "Graphviz 'sfdp' failed to run; produced a circular fallback layout "
        "instead of a force-directed one."
    ),
    LAYOUT_DEGRADED_SFDP_INCOMPLETE: (
        "Graphviz 'sfdp' returned an incomplete layout; produced a circular "
        "fallback layout instead of a force-directed one."
    ),
}
_LAYOUT_DEGRADED_WARNING_FALLBACK = (
    "The layout degraded to a circular fallback instead of a force-directed one."
)


def layout_degraded_warning(reason: str | None) -> str:
    if reason is None:
        return _LAYOUT_DEGRADED_WARNING_FALLBACK
    return _LAYOUT_DEGRADED_WARNINGS.get(reason, _LAYOUT_DEGRADED_WARNING_FALLBACK)


def prepare_response_from_result(
    dataset_id: str,
    result: PreparedLayoutResult,
    submit_warnings: tuple[str, ...],
) -> GraphPrepareResponse:
    layout_warnings: list[str] = []
    if result.layout_status == "degraded":
        layout_warnings.append(layout_degraded_warning(result.layout_degraded_reason))
    distinct_thresholds = {
        cluster.threshold
        for cluster in result.artifacts.clusters
        if cluster.threshold is not None
    }
    return GraphPrepareResponse(
        dataset_id=dataset_id,
        layout_version=result.artifacts.layout_version,
        node_count=len(result.artifacts.dataset.nodes),
        edge_count=len(result.artifacts.dataset.edges),
        cluster_count=len(result.artifacts.clusters),
        lod_tier_count=max(len(distinct_thresholds), 1),
        layout_status=result.layout_status,
        warnings=[*submit_warnings, *layout_warnings],
    )
