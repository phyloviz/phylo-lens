from __future__ import annotations

from phylo_lens_server.http.graph.schemas import (
    GraphLayoutBounds,
    GraphMetadataField,
    GraphRegionResponse,
    GraphSearchMatch,
    GraphSearchResponse,
    GraphViewportEdge,
    GraphViewportNode,
    GraphViewportResponse,
)
from phylo_lens_server.pipeline.models import (
    RegionReadResult,
    SearchReadResult,
    ViewportReadResult,
)
from phylo_lens_server.services.prepare_response import (
    layout_degraded_warning as layout_degraded_warning,
    prepare_response_from_result as prepare_response_from_result,
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
                cluster_id=match.cluster_id,
                x=match.x,
                y=match.y,
            )
            for match in result.matches
        ],
        total_count=result.total_count,
    )
