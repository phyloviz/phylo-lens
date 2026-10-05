import type { AncillaryDataInput, AncillaryObservation, AncillaryData, AncillaryField, Isolate } from "./ancillary";
import type { SourceFormat } from "./models";

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

export interface GraphPrepareRequest {
  format: SourceFormat;
  datasetName?: string;
  content: string;

  options?: {
    allowSelfLoops?: boolean;
  };

  ancillarySchema?: readonly AncillaryField[];
  ancillaryByNodeId?: Record<string, AncillaryData>;

  ancillaryData?: AncillaryDataInput;

  sfdpOptions?: SfdpOptions;
}

export interface GraphViewportRequest {
  datasetId: string;
  layoutVersion?: string | null;
  clusterId?: string | null;
  focusNodeId?: string | null;
  xmin?: number;
  xmax?: number;
  ymin?: number;
  ymax?: number;
  zoom?: number;
  lodLevel?: number | null;
  maxNodes?: number | null;
  /** Adaptive selection ceiling is lodLevel; counts never limit retrieval. */
  lodTargetRepresentations?: number;
  lodSelectionBounds?: { xmin: number; xmax: number; ymin: number; ymax: number };
  previousLodLevel?: number | null;
}

export interface GraphPrepareResult {
  datasetId: string;
  layoutVersion: string;
  nodeCount: number;
  edgeCount: number;
  clusterCount: number;
  lodTierCount?: number;
  layoutStatus: GraphLayoutStatus;
  warnings: string[];
}

export interface GraphPrepareJob {
  jobId: string;
  status: GraphPrepareJobStatus;
  datasetId: string;
}

export interface GraphPrepareStatus {
  jobId: string;
  status: GraphPrepareJobStatus;
  result?: GraphPrepareResult | null;
  error?: string | null;
  errorDetails?: GraphPrepareErrorDetails | null;
}

export interface GraphPrepareErrorDetails {
  algorithm: string;
  stage: string;
  exitStatus?: number | null;
  timeoutSeconds?: number | null;
  stderr?: string | null;
  detail?: string | null;
}

export interface GraphViewportNode {
  id: string;
  clusterId: string;
  x: number;
  y: number;
  layoutStatus: GraphLayoutStatus;
  memberCount: number;
  isRepresentative: boolean;
  metadata?: AncillaryData | null;
  isolates?: Isolate[];
  ancillaryDistribution?: AncillaryObservation[];
}

export interface GraphViewportEdge {
  id: string;
  source: string;
  target: string;
  distance?: number | null;
  isMeta?: boolean | null;
}

export interface GraphLayoutBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface GraphViewportResult {
  datasetId: string;
  layoutVersion: string;
  lodLevel?: number | null;
  zoom: number;
  layoutStatus: GraphLayoutStatus;
  truncated: boolean;
  totalNodeCount: number;
  nodes: GraphViewportNode[];
  edges: GraphViewportEdge[];
  globalBounds?: GraphLayoutBounds | null;
  ancillarySchema?: AncillaryField[];
}

export interface GraphRegionRequest {
  datasetId: string;
  layoutVersion?: string | null;
  xmin: number;
  xmax: number;
  ymin: number;
  ymax: number;
  maxNodes?: number | null;
}

export interface GraphRegionResult {
  datasetId: string;
  layoutVersion: string;
  layoutStatus: GraphLayoutStatus;
  truncated: boolean;
  totalNodeCount: number;
  nodes: GraphViewportNode[];
  edges: GraphViewportEdge[];
  ancillarySchema?: AncillaryField[];
  aggregatedMetadata: AncillaryData;
}

export interface GraphSearchRequest {
  datasetId: string;
  layoutVersion?: string | null;
  query: string;
  limit?: number;
}

export interface GraphSearchMatch {
  nodeId: string;
  score: number;
  matchedText: string;
  clusterId?: string | null;
  x?: number | null;
  y?: number | null;
}

export interface GraphSearchResult {
  datasetId: string;
  query: string;
  matches: GraphSearchMatch[];
  totalCount: number;
}

export interface GraphAncillaryRequest {
  datasetId: string;
  layoutVersion: string;
  ancillaryData: AncillaryDataInput;
}

export interface GraphAncillaryResult {
  datasetId: string;
  layoutVersion: string;
  matchedNodeCount: number;
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
  prepareGraph(request: GraphPrepareRequest, options?: PrepareGraphOptions): Promise<GraphPrepareResult>;

  applyAncillaryData(request: GraphAncillaryRequest): Promise<GraphAncillaryResult>;

  readViewport(query: GraphViewportRequest): Promise<GraphViewportResult>;

  readRegion(query: GraphRegionRequest): Promise<GraphRegionResult>;

  searchGraph(query: GraphSearchRequest): Promise<GraphSearchResult>;
}
