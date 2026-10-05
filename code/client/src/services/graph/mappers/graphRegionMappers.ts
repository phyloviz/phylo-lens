import type { GraphRegionRequest } from "../../../contracts/graph/region/GraphRegionRequest";
import type { GraphRegionRequestDto } from "../models/region/GraphRegionRequestDto";
import type { GraphRegionResponseDto } from "../models/region/GraphRegionResponseDto";
import type { GraphRegionResult } from "../../../contracts/graph/region/GraphRegionResult";
import { toGraphViewportNode, toGraphViewportEdge } from "./graphViewportMappers";

export function toGraphRegionRequestDto(request: GraphRegionRequest): GraphRegionRequestDto {
  return {
    dataset_id: request.datasetId,
    layout_version: request.layoutVersion,
    xmin: request.xmin,
    xmax: request.xmax,
    ymin: request.ymin,
    ymax: request.ymax,
    max_nodes: request.maxNodes,
  };
}

export function toGraphRegionResult(dto: GraphRegionResponseDto): GraphRegionResult {
  return {
    datasetId: dto.dataset_id,
    layoutVersion: dto.layout_version,
    layoutStatus: dto.layout_status,
    truncated: dto.truncated,
    totalNodeCount: dto.total_node_count,
    nodes: dto.nodes.map(toGraphViewportNode),
    edges: dto.edges.map(toGraphViewportEdge),
    ancillarySchema: dto.metadata_schema,
    aggregatedMetadata: dto.aggregated_metadata,
  };
}
