import type { GraphPrepareRequest } from "../../../contracts/graph/prepare/GraphPrepareRequest";
import type { GraphPrepareRequestDto } from "../models/prepare/GraphPrepareRequestDto";
import { toAncillaryDataInputDto } from "./graphAncillaryMappers";
import type { GraphPrepareResponseDto } from "../models/prepare/GraphPrepareResponseDto";
import type { GraphPrepareResult } from "../../../contracts/graph/prepare/GraphPrepareResult";
import type { GraphPrepareJobDto } from "../models/prepare/GraphPrepareJobDto";
import type { GraphPrepareJob } from "../../../contracts/graph/prepare/GraphPrepareJob";
import type { GraphPrepareStatusDto } from "../models/prepare/GraphPrepareStatusDto";
import type { GraphPrepareStatus } from "../../../contracts/graph/prepare/GraphPrepareStatus";

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

function toGraphPrepareResult(dto: GraphPrepareResponseDto): GraphPrepareResult {
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
