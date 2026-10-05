import type { GraphViewportRequest } from "../../../contracts/graph/viewport/GraphViewportRequest";
import type { GraphViewportRequestDto } from "../models/viewport/GraphViewportRequestDto";
import type { GraphIsolateDto } from "../models/viewport/GraphIsolateDto";
import type { Isolate } from "../../../contracts/ancillary";
import type { GraphViewportNodeDto } from "../models/viewport/GraphViewportNodeDto";
import type { GraphViewportNode } from "../../../contracts/graph/viewport/GraphViewportNode";
import type { GraphViewportEdgeDto } from "../models/viewport/GraphViewportEdgeDto";
import type { GraphViewportEdge } from "../../../contracts/graph/viewport/GraphViewportEdge";
import type { GraphLayoutBoundsDto } from "../models/viewport/GraphLayoutBoundsDto";
import type { GraphLayoutBounds } from "../../../contracts/graph/viewport/GraphLayoutBounds";
import type { GraphViewportResponseDto } from "../models/viewport/GraphViewportResponseDto";
import type { GraphViewportResult } from "../../../contracts/graph/viewport/GraphViewportResult";

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

export function toGraphViewportNode(dto: GraphViewportNodeDto): GraphViewportNode {
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

export function toGraphViewportEdge(dto: GraphViewportEdgeDto): GraphViewportEdge {
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
