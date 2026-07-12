import type { SourceFormat } from "../contracts/models";

export type GraphPrepareJobStatus = "pending" | "ready" | "failed";

export type GraphLayoutStatus = "pending" | "refining" | "ready" | "degraded" | "failed";

export type GraphMetadataValue = string | number | boolean | null;

export type GraphMetadata = Record<string, GraphMetadataValue>;

export interface GraphMetadataField {
  key: string;
  type: string;
}

export interface NormalizeRequest {
  format: SourceFormat;
  dataset_name: string;
  content: string;
  options?: {
    allow_self_loops?: boolean;
  };
  metadata_schema?: GraphMetadataField[];
  metadata_by_node_id?: Record<string, GraphMetadata>;
  ancillary_data?: {
    content: string;
    join_column?: string;
    format?: "auto" | "csv" | "tsv";
  };
}

export interface GraphViewportQuery {
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
  max_nodes?: number;
}

export interface GraphPrepareResponse {
  dataset_id: string;
  layout_version: string;
  node_count: number;
  edge_count: number;
  cluster_count: number;
  lod_tier_count?: number;
  layout_status: GraphLayoutStatus;
  warnings: string[];
}

export interface GraphPrepareJob {
  job_id: string;
  status: GraphPrepareJobStatus;
  dataset_id: string;
}

export interface GraphPrepareStatus {
  job_id: string;
  status: GraphPrepareJobStatus;
  result?: GraphPrepareResponse | null;
  error?: string | null;
}

export interface GraphViewportNode {
  id: string;
  cluster_id: string;
  x: number;
  y: number;
  layout_status: GraphLayoutStatus;
  member_count: number;
  is_representative: boolean;
  metadata?: GraphMetadata | null;
}

export interface GraphViewportEdge {
  id: string;
  source: string;
  target: string;
  distance?: number | null;
  is_meta?: boolean | null;
  bundled_edge_count?: number | null;
}

export interface GraphViewportResponse {
  dataset_id: string;
  layout_version: string;
  lod_level?: number | null;
  zoom: number;
  layout_status: GraphLayoutStatus;
  truncated: boolean;
  total_node_count: number;
  nodes: GraphViewportNode[];
  edges: GraphViewportEdge[];
  metadata_schema?: GraphMetadataField[];
}

export interface GraphRegionQuery {
  dataset_id: string;
  layout_version?: string | null;
  xmin: number;
  xmax: number;
  ymin: number;
  ymax: number;
  max_nodes?: number;
}

export interface GraphRegionResponse {
  dataset_id: string;
  layout_version: string;
  layout_status: GraphLayoutStatus;
  truncated: boolean;
  total_node_count: number;
  nodes: GraphViewportNode[];
  edges: GraphViewportEdge[];
  metadata_schema?: GraphMetadataField[];
  aggregated_metadata: GraphMetadata;
}

export interface GraphSearchQuery {
  dataset_id: string;
  layout_version?: string | null;
  query: string;
  limit?: number;
}

export interface GraphSearchMatch {
  node_id: string;
  score: number;
  matched_text: string;
  cluster_id?: string | null;
  x?: number | null;
  y?: number | null;
}

export interface GraphSearchResponse {
  dataset_id: string;
  query: string;
  matches: GraphSearchMatch[];
  total_count: number;
}
