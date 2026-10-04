import type { AncillaryObservation } from "../contracts/ancillary";
import type { AncillaryType, SourceFormat } from "../contracts/models";

export const GraphPrepareJobStatus = {
  PENDING: "pending",
  READY: "ready",
  FAILED: "failed",
} as const;
export type GraphPrepareJobStatus = (typeof GraphPrepareJobStatus)[keyof typeof GraphPrepareJobStatus];

export const GraphLayoutStatus = {
  PENDING: "pending",
  REFINING: "refining",
  READY: "ready",
  DEGRADED: "degraded",
  FAILED: "failed",
} as const;
export type GraphLayoutStatus = (typeof GraphLayoutStatus)[keyof typeof GraphLayoutStatus];

export type GraphAncillaryValue = import("../contracts/ancillary").AncillaryValue;

export type GraphAncillaryData = import("../contracts/ancillary").AncillaryData;

/** Supported Graphviz SFDP overrides for a prepared layout. */
export interface SfdpOptions {
  k?: number;
  repulsiveForce?: number;
  overlap?: "prism" | "scale";
  prismIterations?: number;
  overlapScaling?: number;
  smoothing?: "none" | "avg_dist" | "graph_dist" | "power_dist" | "rng" | "spring" | "triangle";
  quadtree?: "none" | "normal" | "fast";
  beautify?: boolean;
}

export interface GraphAncillaryField {
  key: string;
  type: AncillaryType;
}

export interface NormalizeRequest {
  format: SourceFormat;
  dataset_name: string;
  content: string;
  options?: {
    allow_self_loops?: boolean;
  };
  metadata_schema?: readonly GraphAncillaryField[];
  metadata_by_node_id?: Record<string, GraphAncillaryData>;
  ancillary_data?: {
    content: string;
    join_column: string;
    format?: "auto" | "csv" | "tsv";
  };
  sfdp_options?: SfdpOptions;
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
  max_nodes?: number | null;
  /** Adaptive selection ceiling is lod_level; counts never limit retrieval. */
  lod_target_representations?: number;
  lod_selection_bounds?: { xmin: number; xmax: number; ymin: number; ymax: number };
  previous_lod_level?: number | null;
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
  error_details?: GraphPrepareErrorDetails | null;
}

export interface GraphPrepareErrorDetails {
  algorithm: string;
  stage: string;
  exit_status?: number | null;
  timeout_seconds?: number | null;
  stderr?: string | null;
  detail?: string | null;
}

export interface GraphIsolate {
  id: string;
  metadata: GraphAncillaryData;
}

export interface GraphViewportNode {
  id: string;
  cluster_id: string;
  x: number;
  y: number;
  layout_status: GraphLayoutStatus;
  member_count: number;
  is_representative: boolean;
  metadata?: GraphAncillaryData | null;
  isolates?: GraphIsolate[];
  ancillary_distribution?: AncillaryObservation[];
}

export interface GraphViewportEdge {
  id: string;
  source: string;
  target: string;
  distance?: number | null;
  is_meta?: boolean | null;
}

export interface GraphLayoutBounds {
  min_x: number;
  max_x: number;
  min_y: number;
  max_y: number;
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
  global_bounds?: GraphLayoutBounds | null;
  metadata_schema?: GraphAncillaryField[];
}

export interface GraphRegionQuery {
  dataset_id: string;
  layout_version?: string | null;
  xmin: number;
  xmax: number;
  ymin: number;
  ymax: number;
  max_nodes?: number | null;
}

export interface GraphRegionResponse {
  dataset_id: string;
  layout_version: string;
  layout_status: GraphLayoutStatus;
  truncated: boolean;
  total_node_count: number;
  nodes: GraphViewportNode[];
  edges: GraphViewportEdge[];
  metadata_schema?: GraphAncillaryField[];
  aggregated_metadata: GraphAncillaryData;
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

export interface GraphAncillaryRequest {
  dataset_id: string;
  layout_version: string;
  ancillary_data: NonNullable<NormalizeRequest["ancillary_data"]>;
}

export interface GraphAncillaryResponse {
  dataset_id: string;
  layout_version: string;
  matched_node_count: number;
  warnings: string[];
}

export interface PrepareGraphOptions {
  onPending?: (status: GraphPrepareStatus) => void;
  pollIntervalMs?: number;
  // Optional host-side wait limit. The default is unlimited so a valid global
  // `sfdp` preparation is not abandoned merely because it is expensive.
  pollTimeoutMs?: number | null;
  sleep?: (ms: number) => Promise<void>;
}

export interface GraphClient {
  prepareGraph(request: NormalizeRequest, options?: PrepareGraphOptions): Promise<GraphPrepareResponse>;

  applyAncillaryData(request: GraphAncillaryRequest): Promise<GraphAncillaryResponse>;

  readViewport(query: GraphViewportQuery): Promise<GraphViewportResponse>;

  readRegion(query: GraphRegionQuery): Promise<GraphRegionResponse>;

  searchGraph(query: GraphSearchQuery): Promise<GraphSearchResponse>;
}
