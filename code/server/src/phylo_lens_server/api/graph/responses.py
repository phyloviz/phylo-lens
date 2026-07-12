from __future__ import annotations

from phylo_lens_server.api.graph.schemas import (
    GraphMetadataField,
    GraphPrepareResponse,
    GraphRegionResponse,
    GraphSearchMatch,
    GraphSearchResponse,
    GraphViewportEdge,
    GraphViewportNode,
    GraphViewportResponse,
)
from phylo_lens_server.prepared_layout.layout import (
    LAYOUT_DEGRADED_SFDP_FAILED,
    LAYOUT_DEGRADED_SFDP_INCOMPLETE,
    LAYOUT_DEGRADED_SFDP_MISSING,
)
from phylo_lens_server.prepared_layout.models import (
    PreparedLayoutResult,
    RegionReadResult,
    SearchReadResult,
    ViewportReadResult,
)

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


def graph_viewport_response_from_result(
    result: ViewportReadResult,
    *,
    lod_level: int | None,
    zoom: float,
) -> GraphViewportResponse:
    return GraphViewportResponse(
        dataset_id=result.dataset_id,
        layout_version=result.layout_version,
        lod_level=lod_level,
        zoom=zoom,
        layout_status=result.layout_status,
        truncated=result.truncated,
        total_node_count=result.total_node_count,
        nodes=[
            GraphViewportNode(
                id=node.node_id,
                cluster_id=node.cluster_id,
                x=node.x,
                y=node.y,
                layout_status=node.layout_status,
                member_count=node.member_count,
                is_representative=node.is_representative,
                metadata=node.metadata,
            )
            for node in result.nodes
        ],
        edges=[
            GraphViewportEdge(
                id=edge.edge_id,
                source=edge.source,
                target=edge.target,
                distance=edge.distance,
                is_meta=edge.is_meta,
                bundled_edge_count=edge.bundled_edge_count,
            )
            for edge in result.edges
        ],
        metadata_schema=[
            GraphMetadataField(key=field.key, type=field.type)
            for field in result.metadata_schema
        ],
    )


def graph_region_response_from_result(
    result: RegionReadResult,
) -> GraphRegionResponse:
    return GraphRegionResponse(
        dataset_id=result.dataset_id,
        layout_version=result.layout_version,
        layout_status=result.layout_status,
        truncated=result.truncated,
        total_node_count=result.total_node_count,
        nodes=[
            GraphViewportNode(
                id=node.node_id,
                cluster_id=node.cluster_id,
                x=node.x,
                y=node.y,
                layout_status=node.layout_status,
                member_count=node.member_count,
                is_representative=node.is_representative,
                metadata=node.metadata,
            )
            for node in result.nodes
        ],
        edges=[
            GraphViewportEdge(
                id=edge.edge_id,
                source=edge.source,
                target=edge.target,
                distance=edge.distance,
                is_meta=edge.is_meta,
                bundled_edge_count=edge.bundled_edge_count,
            )
            for edge in result.edges
        ],
        metadata_schema=[
            GraphMetadataField(key=field.key, type=field.type)
            for field in result.metadata_schema
        ],
        aggregated_metadata=result.aggregated_metadata,
    )


def graph_search_response_from_result(
    result: SearchReadResult,
) -> GraphSearchResponse:
    return GraphSearchResponse(
        dataset_id=result.dataset_id,
        layout_version=result.layout_version,
        query=result.query,
        matches=[
            GraphSearchMatch(
                node_id=match.node_id,
                score=match.score,
                matched_text=match.matched_text,
                x=match.x,
                y=match.y,
            )
            for match in result.matches
        ],
        total_count=result.total_count,
    )
