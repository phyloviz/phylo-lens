import type { AncillaryDataInput, Isolate } from "../contracts/ancillary";
import type {
  GraphAncillaryRequest,
  GraphAncillaryResult,
  GraphLayoutBounds,
  GraphPrepareRequest,
  GraphPrepareResult,
  GraphPrepareJob,
  GraphPrepareStatus,
  GraphRegionRequest,
  GraphRegionResult,
  GraphSearchRequest,
  GraphSearchResult,
  GraphViewportRequest,
  GraphViewportResult,
  GraphViewportNode,
  GraphViewportEdge,
} from "../contracts/graph";
import type {
  AncillaryDataInputDto,
  GraphAncillaryRequestDto,
  GraphAncillaryResponseDto,
  GraphPrepareRequestDto,
  GraphPrepareResponseDto,
  GraphPrepareJobDto,
  GraphPrepareStatusDto,
  GraphRegionRequestDto,
  GraphRegionResponseDto,
  GraphSearchRequestDto,
  GraphSearchResponseDto,
  GraphViewportRequestDto,
  GraphViewportResponseDto,
  GraphViewportNodeDto,
  GraphViewportEdgeDto,
  GraphLayoutBoundsDto,
  GraphIsolateDto,
} from "./dto/graph.dto";

function toAncillaryDataInputDto(input: AncillaryDataInput): AncillaryDataInputDto {
  return { content: input.content, join_column: input.joinColumn, format: input.format };
}

export function toGraphPrepareRequestDto(request: GraphPrepareRequest): GraphPrepareRequestDto {
  return {
    format: request.format,
    dataset_name: request.datasetName,
    content: request.content,
    options: request.options === undefined ? undefined : { allow_self_loops: request.options.allowSelfLoops },
    metadata_schema: request.ancillarySchema,
    metadata_by_node_id: request.ancillaryByNodeId,
    ancillary_data: request.ancillaryData === undefined ? undefined : toAncillaryDataInputDto(request.ancillaryData),
    sfdp_options: request.sfdpOptions,
  };
}

export function toGraphPrepareResult(dto: GraphPrepareResponseDto): GraphPrepareResult {
  return {
    datasetId: dto.dataset_id,
    layoutVersion: dto.layout_version,
    nodeCount: dto.node_count,
    edgeCount: dto.edge_count,
    clusterCount: dto.cluster_count,
    lodTierCount: dto.lod_tier_count,
    layoutStatus: dto.layout_status,
    warnings: dto.warnings,
  };
}

export function toGraphPrepareJob(dto: GraphPrepareJobDto): GraphPrepareJob {
  return { jobId: dto.job_id, status: dto.status, datasetId: dto.dataset_id };
}

export function toGraphPrepareStatus(dto: GraphPrepareStatusDto): GraphPrepareStatus {
  return {
    jobId: dto.job_id,
    status: dto.status,
    result: dto.result == null ? dto.result : toGraphPrepareResult(dto.result),
    error: dto.error,
    errorDetails:
      dto.error_details == null
        ? dto.error_details
        : {
            algorithm: dto.error_details.algorithm,
            stage: dto.error_details.stage,
            exitStatus: dto.error_details.exit_status,
            timeoutSeconds: dto.error_details.timeout_seconds,
            stderr: dto.error_details.stderr,
            detail: dto.error_details.detail,
          },
  };
}

export function toGraphViewportRequestDto(request: GraphViewportRequest): GraphViewportRequestDto {
  return {
    dataset_id: request.datasetId,
    layout_version: request.layoutVersion,
    cluster_id: request.clusterId,
    focus_node_id: request.focusNodeId,
    xmin: request.xmin,
    xmax: request.xmax,
    ymin: request.ymin,
    ymax: request.ymax,
    zoom: request.zoom,
    lod_level: request.lodLevel,
    max_nodes: request.maxNodes,
    lod_target_representations: request.lodTargetRepresentations,
    lod_selection_bounds: request.lodSelectionBounds,
    previous_lod_level: request.previousLodLevel,
  };
}

function toGraphIsolate(dto: GraphIsolateDto): Isolate {
  return { id: dto.id, ancillaryData: dto.metadata };
}

function toGraphViewportNode(dto: GraphViewportNodeDto): GraphViewportNode {
  return {
    id: dto.id,
    clusterId: dto.cluster_id,
    x: dto.x,
    y: dto.y,
    layoutStatus: dto.layout_status,
    memberCount: dto.member_count,
    isRepresentative: dto.is_representative,
    metadata: dto.metadata,
    isolates: dto.isolates?.map(toGraphIsolate),
    ancillaryDistribution: dto.ancillary_distribution,
  };
}

function toGraphViewportEdge(dto: GraphViewportEdgeDto): GraphViewportEdge {
  return { id: dto.id, source: dto.source, target: dto.target, distance: dto.distance, isMeta: dto.is_meta };
}

function toGraphLayoutBounds(dto: GraphLayoutBoundsDto): GraphLayoutBounds {
  return { minX: dto.min_x, maxX: dto.max_x, minY: dto.min_y, maxY: dto.max_y };
}

export function toGraphViewportResult(dto: GraphViewportResponseDto): GraphViewportResult {
  return {
    datasetId: dto.dataset_id,
    layoutVersion: dto.layout_version,
    lodLevel: dto.lod_level,
    zoom: dto.zoom,
    layoutStatus: dto.layout_status,
    truncated: dto.truncated,
    totalNodeCount: dto.total_node_count,
    nodes: dto.nodes.map(toGraphViewportNode),
    edges: dto.edges.map(toGraphViewportEdge),
    globalBounds: dto.global_bounds == null ? dto.global_bounds : toGraphLayoutBounds(dto.global_bounds),
    ancillarySchema: dto.metadata_schema,
  };
}

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

export function toGraphSearchRequestDto(request: GraphSearchRequest): GraphSearchRequestDto {
  return {
    dataset_id: request.datasetId,
    layout_version: request.layoutVersion,
    query: request.query,
    limit: request.limit,
  };
}

export function toGraphSearchResult(dto: GraphSearchResponseDto): GraphSearchResult {
  return {
    datasetId: dto.dataset_id,
    query: dto.query,
    totalCount: dto.total_count,
    matches: dto.matches.map((match) => ({
      nodeId: match.node_id,
      score: match.score,
      matchedText: match.matched_text,
      clusterId: match.cluster_id,
      x: match.x,
      y: match.y,
    })),
  };
}

export function toGraphAncillaryRequestDto(request: GraphAncillaryRequest): GraphAncillaryRequestDto {
  return {
    dataset_id: request.datasetId,
    layout_version: request.layoutVersion,
    ancillary_data: toAncillaryDataInputDto(request.ancillaryData),
  };
}

export function toGraphAncillaryResult(dto: GraphAncillaryResponseDto): GraphAncillaryResult {
  return {
    datasetId: dto.dataset_id,
    layoutVersion: dto.layout_version,
    matchedNodeCount: dto.matched_node_count,
    warnings: dto.warnings,
  };
}
