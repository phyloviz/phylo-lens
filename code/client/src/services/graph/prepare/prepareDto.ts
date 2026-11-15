import type { GraphPrepareJobStatus, GraphLayoutStatus } from '../../../contracts/graph/graphTypes';
import type { SourceFormat } from '../../../contracts/models';
import type { TypingOptions } from '../../../contracts/graph/TypingOptions';
import type { AncillaryField, AncillaryData } from '../../../contracts/ancillary';
import type { AncillaryDataInputDto } from '../ancillary/ancillaryDto';
import type { SfdpOptions } from '../../../contracts/graph/SfdpOptions';
export interface GraphPrepareErrorDetailsDto {
  algorithm: string;
  stage: string;
  exit_status?: number | null;
  timeout_seconds?: number | null;
  stderr?: string | null;
  detail?: string | null;
}

export interface GraphPrepareJobDto {
  job_id: string;
  status: GraphPrepareJobStatus;
  dataset_id: string;
}

export interface GraphPrepareRequestDto {
  format: SourceFormat;
  dataset_name?: string;
  content: string;
  distance_cutoff?: number;
  typing_options?: TypingOptions;

  options?: {
    allow_self_loops?: false;
  };

  metadata_schema?: readonly AncillaryField[];
  metadata_by_node_id?: Record<string, AncillaryData>;

  ancillary_data?: AncillaryDataInputDto;

  sfdp_options?: SfdpOptions;
  lod_options?: { small_component_threshold?: number };
}

export interface GraphPrepareResponseDto {
  typing_options?: TypingOptions | null;
  distance_cutoff?: number | null;
  dataset_id: string;
  layout_version: string;
  node_count: number;
  edge_count: number;
  cluster_count: number;
  lod_tier_count?: number;
  technical_roots?: string[];
  layout_status: GraphLayoutStatus;
  warnings: string[];
}

export interface GraphPrepareStatusDto {
  job_id: string;
  status: GraphPrepareJobStatus;
  result?: GraphPrepareResponseDto | null;
  error?: string | null;
  error_details?: GraphPrepareErrorDetailsDto | null;
}
