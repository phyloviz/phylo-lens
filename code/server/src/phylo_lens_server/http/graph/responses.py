from __future__ import annotations

from phylo_lens_server.domain.search import SearchReadResult
from phylo_lens_server.domain.views import (
    RegionReadResult,
    ViewportEdge,
    ViewportNode,
    ViewportReadResult,
)
from phylo_lens_server.http.graph.schemas import (
    GraphAncillaryField,
    GraphIsolate,
    GraphLayoutBounds,
    GraphRegionResponse,
    GraphSearchMatch,
    GraphSearchResponse,
    GraphViewportEdge,
    GraphViewportNode,
    GraphViewportResponse,
)


def graph_viewport_response_from_result(
    result: ViewportReadResult,
) -> GraphViewportResponse:
    return GraphViewportResponse(
        dataset_id=result.dataset_id,
        layout_version=result.layout_version,
        lod_level=result.lod_level,
        zoom=result.zoom,
        layout_status=result.layout_status,
        truncated=result.truncated,
        total_node_count=result.total_node_count,
        nodes=[node_response(node) for node in result.nodes],
        edges=[edge_response(edge) for edge in result.edges],
        global_bounds=(
            GraphLayoutBounds(
                min_x=result.global_bounds.min_x,
                max_x=result.global_bounds.max_x,
                min_y=result.global_bounds.min_y,
                max_y=result.global_bounds.max_y,
            )
            if result.global_bounds is not None
            else None
        ),
        metadata_schema=[
            GraphAncillaryField(key=field.key, type=field.type)
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
        nodes=[node_response(node) for node in result.nodes],
        edges=[edge_response(edge) for edge in result.edges],
        metadata_schema=[
            GraphAncillaryField(key=field.key, type=field.type)
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
                cluster_id=match.cluster_id,
                x=match.x,
                y=match.y,
            )
            for match in result.matches
        ],
        total_count=result.total_count,
    )


def node_response(node: ViewportNode) -> GraphViewportNode:
    return GraphViewportNode(
        id=node.node_id,
        cluster_id=node.cluster_id,
        x=node.x,
        y=node.y,
        layout_status=node.layout_status,
        member_count=node.member_count,
        is_representative=node.is_representative,
        metadata=node.metadata,
        isolates=[GraphIsolate.model_validate(isolate) for isolate in node.isolates],
        ancillary_distribution=list(node.ancillary_distribution),
    )


def edge_response(edge: ViewportEdge) -> GraphViewportEdge:
    return GraphViewportEdge(
        id=edge.edge_id,
        source=edge.source,
        target=edge.target,
        distance=edge.distance,
        is_meta=edge.is_meta,
    )
