import type { AncillaryData, AncillaryField, AncillaryObservation } from "../../contracts/ancillary";
import type { SourceFormat } from "../../contracts/models";
import type { GraphLayoutStatus, GraphPrepareJobStatus, SfdpOptions } from "../../contracts/graph";

export interface AncillaryDataInputDto {
  content: string;
  join_column: string;
  format?: "auto" | "csv" | "tsv";
}

export interface GraphPrepareRequestDto {
  format: SourceFormat;
  dataset_name?: string;
  content: string;

  options?: {
    allow_self_loops?: boolean;
  };

  metadata_schema?: readonly AncillaryField[];
  metadata_by_node_id?: Record<string, AncillaryData>;

  ancillary_data?: AncillaryDataInputDto;

  sfdp_options?: SfdpOptions;
}

export interface GraphViewportRequestDto {
  dataset_id: string;
  layout_version?: string | null;
  cluster_id?: string | null;
  focus_node_id?: string | null;
  xmin?: number;
  xmax?: number;
  ymin?: number;
  ymax?: number;
  zoom?: number;
  lod_level?: number | null;
  max_nodes?: number | null;
  /** Adaptive selection ceiling is lod_level; counts never limit retrieval. */
  lod_target_representations?: number;
  lod_selection_bounds?: { xmin: number; xmax: number; ymin: number; ymax: number };
  previous_lod_level?: number | null;
}

export interface GraphPrepareResponseDto {
  dataset_id: string;
  layout_version: string;
  node_count: number;
  edge_count: number;
  cluster_count: number;
  lod_tier_count?: number;
  layout_status: GraphLayoutStatus;
  warnings: string[];
}

export interface GraphPrepareJobDto {
  job_id: string;
  status: GraphPrepareJobStatus;
  dataset_id: string;
}

export interface GraphPrepareStatusDto {
  job_id: string;
  status: GraphPrepareJobStatus;
  result?: GraphPrepareResponseDto | null;
  error?: string | null;
  error_details?: GraphPrepareErrorDetailsDto | null;
}

export interface GraphPrepareErrorDetailsDto {
  algorithm: string;
  stage: string;
  exit_status?: number | null;
  timeout_seconds?: number | null;
  stderr?: string | null;
  detail?: string | null;
}

export interface GraphIsolateDto {
  id: string;
  metadata: AncillaryData;
}

export interface GraphViewportNodeDto {
  id: string;
  cluster_id: string;
  x: number;
  y: number;
  layout_status: GraphLayoutStatus;
  member_count: number;
  is_representative: boolean;
  metadata?: AncillaryData | null;
  isolates?: GraphIsolateDto[];
  ancillary_distribution?: AncillaryObservation[];
}

export interface GraphViewportEdgeDto {
  id: string;
  source: string;
  target: string;
  distance?: number | null;
  is_meta?: boolean | null;
}

export interface GraphLayoutBoundsDto {
  min_x: number;
  max_x: number;
  min_y: number;
  max_y: number;
}

export interface GraphViewportResponseDto {
  dataset_id: string;
  layout_version: string;
  lod_level?: number | null;
  zoom: number;
  layout_status: GraphLayoutStatus;
  truncated: boolean;
  total_node_count: number;
  nodes: GraphViewportNodeDto[];
  edges: GraphViewportEdgeDto[];
  global_bounds?: GraphLayoutBoundsDto | null;
  metadata_schema?: AncillaryField[];
}

export interface GraphRegionRequestDto {
  dataset_id: string;
  layout_version?: string | null;
  xmin: number;
  xmax: number;
  ymin: number;
  ymax: number;
  max_nodes?: number | null;
}

export interface GraphRegionResponseDto {
  dataset_id: string;
  layout_version: string;
  layout_status: GraphLayoutStatus;
  truncated: boolean;
  total_node_count: number;
  nodes: GraphViewportNodeDto[];
  edges: GraphViewportEdgeDto[];
  metadata_schema?: AncillaryField[];
  aggregated_metadata: AncillaryData;
}

export interface GraphSearchRequestDto {
  dataset_id: string;
  layout_version?: string | null;
  query: string;
  limit?: number;
}

export interface GraphSearchMatchDto {
  node_id: string;
  score: number;
  matched_text: string;
  cluster_id?: string | null;
  x?: number | null;
  y?: number | null;
}

export interface GraphSearchResponseDto {
  dataset_id: string;
  query: string;
  matches: GraphSearchMatchDto[];
  total_count: number;
}

export interface GraphAncillaryRequestDto {
  dataset_id: string;
  layout_version: string;
  ancillary_data: AncillaryDataInputDto;
}

export interface GraphAncillaryResponseDto {
  dataset_id: string;
  layout_version: string;
  matched_node_count: number;
  warnings: string[];
}

export interface ServiceInformationDto {
  status: string;
  service_version: string;
  api_version: string;
}
