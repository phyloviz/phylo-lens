import {
  isArrayOf,
  isBoolean,
  isFiniteNumber,
  isOptionalBoolean,
  isOptionalFiniteNumber,
  isOptionalString,
  isRecord,
  isString,
} from "../validation/guards";
import { type SourceFormat } from "../contracts/models";
import { createHttpClient, type HttpClient } from "./httpClient";

export const ROUTE_GRAPH_PREPARE = "/api/graph/prepare";
export const ROUTE_GRAPH_VIEWPORT = "/api/graph/viewport";
export const ROUTE_GRAPH_REGION = "/api/graph/region";
export const ROUTE_GRAPH_SEARCH = "/api/graph/search";
export const ERR_INVALID_GRAPH_PREPARE_RESPONSE = "Invalid graph prepare response contract.";
export const ERR_INVALID_GRAPH_PREPARE_JOB = "Invalid graph prepare job contract.";
export const ERR_INVALID_GRAPH_PREPARE_STATUS = "Invalid graph prepare status contract.";
export const ERR_GRAPH_PREPARE_FAILED = "Graph layout preparation failed.";
export const ERR_GRAPH_PREPARE_TIMED_OUT = "Graph layout preparation did not complete in time.";
export const ERR_INVALID_GRAPH_VIEWPORT_RESPONSE = "Invalid graph viewport response contract.";
export const ERR_INVALID_GRAPH_REGION_RESPONSE = "Invalid graph region response contract.";
export const ERR_INVALID_GRAPH_SEARCH_RESPONSE = "Invalid graph search response contract.";

// Layout runs on a background worker, so /prepare returns a job the client polls
// at /prepare/{job_id} until it is ready. These govern the polling cadence and
// budget; large trees can take a while, so the ceiling is generous.
export const DEFAULT_PREPARE_POLL_INTERVAL_MS = 1000;
export const DEFAULT_PREPARE_POLL_TIMEOUT_MS = 600_000;

export type GraphPrepareJobStatus = "pending" | "ready" | "failed";

// "degraded" is emitted by the server when the force layout fell back to a
// circular scatter (e.g. Graphviz sfdp missing/failed); the coordinates then
// ignore tree topology, so the client surfaces a warning rather than implying a
// faithful layout.
export type GraphLayoutStatus =
  | "pending"
  | "refining"
  | "ready"
  | "degraded"
  | "failed";

export type GraphMetadataValue = string | number | boolean | null;

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
  metadata_schema?: Array<{ key: string; type: string }>;
  metadata_by_node_id?: Record<
    string,
    Record<string, string | number | boolean | null>
  >;
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
  // Number of precomputed LoD tiers (distinct distance thresholds) the client
  // can map camera zoom onto. Optional for backward compatibility; treated as 1
  // (finest detail only) when absent.
  lod_tier_count?: number;
  layout_status: GraphLayoutStatus;
  warnings: string[];
}

export interface GraphPrepareJob {
  job_id: string;
  status: string;
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
  metadata?: Record<string, GraphMetadataValue> | null;
}

export interface GraphViewportEdge {
  id: string;
  source: string;
  target: string;
  distance?: number | null;
  // Meta-edge fields. Present only for rerouted boundary edges of an expanded
  // cluster; ordinary edges omit them (server excludes null values).
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
  // One aggregated value per metadata field across the selected members
  // (mean for numeric fields, mode for everything else).
  aggregated_metadata: Record<string, GraphMetadataValue>;
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
}

export interface GraphSearchResponse {
  dataset_id: string;
  query: string;
  matches: GraphSearchMatch[];
  total_count: number;
}

export interface PrepareGraphOptions {
  // Notified on each poll while the background layout job is still pending, so a
  // caller can drive a progress indicator. Fired once per poll attempt.
  onPending?: (job: GraphPrepareStatus) => void;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
  // Injectable for tests; defaults to setTimeout-based delay.
  sleep?: (ms: number) => Promise<void>;
}

export interface GraphClientOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
}

export interface GraphClient {
  prepareGraph: (
    request: NormalizeRequest,
    options?: PrepareGraphOptions,
  ) => Promise<GraphPrepareResponse>;
  readViewport: (query: GraphViewportQuery,) => Promise<GraphViewportResponse>;
  readRegion: (query: GraphRegionQuery) => Promise<GraphRegionResponse>;
  searchGraph: (query: GraphSearchQuery) => Promise<GraphSearchResponse>;
}

export function createGraphClient(options: GraphClientOptions): GraphClient {
  return createGraphClientFromHttp(
    createHttpClient({
      baseUrl: options.baseUrl,
      fetchImpl: options.fetchImpl,
    }),
  );
}

export function createGraphClientFromHttp(http: HttpClient): GraphClient {
  return {
    prepareGraph: (request, options) => prepareGraph(http, request, options),
    readViewport: (query) => readGraphViewport(http, query),
    readRegion: (query) => readGraphRegion(http, query),
    searchGraph: (query) => searchGraph(http, query),
  };
}

// Submit a background layout job, then poll its status until it resolves. The
// public return type stays GraphPrepareResponse so callers are unaffected by
// the async transport — the polling is fully encapsulated here.
export async function prepareGraph(
  http: HttpClient,
  request: NormalizeRequest,
  options: PrepareGraphOptions = {},
): Promise<GraphPrepareResponse> {
  const job = await submitPrepareGraph(http, request);
  return pollPrepareGraph(http, job.job_id, options);
}

export async function submitPrepareGraph(
  http: HttpClient,
  request: NormalizeRequest,
): Promise<GraphPrepareJob> {
  const response = await http.post<NormalizeRequest, unknown>(
    ROUTE_GRAPH_PREPARE,
    request,
  );

  if (!isGraphPrepareJob(response)) {
    throw new Error(ERR_INVALID_GRAPH_PREPARE_JOB);
  }

  return response;
}

async function pollPrepareGraph(
  http: HttpClient,
  jobId: string,
  options: PrepareGraphOptions,
): Promise<GraphPrepareResponse> {
  const intervalMs = options.pollIntervalMs ?? DEFAULT_PREPARE_POLL_INTERVAL_MS;
  const timeoutMs = options.pollTimeoutMs ?? DEFAULT_PREPARE_POLL_TIMEOUT_MS;
  const sleep = options.sleep ?? defaultSleep;
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const status = await getPrepareGraphStatus(http, jobId);

    if (status.status === "ready") {
      if (!isGraphPrepareResponse(status.result)) {
        throw new Error(ERR_INVALID_GRAPH_PREPARE_RESPONSE);
      }
      return status.result;
    }
    if (status.status === "failed") {
      throw new Error(status.error ?? ERR_GRAPH_PREPARE_FAILED);
    }

    options.onPending?.(status);

    if (Date.now() >= deadline) {
      throw new Error(ERR_GRAPH_PREPARE_TIMED_OUT);
    }
    await sleep(intervalMs);
  }
}

export async function getPrepareGraphStatus(
  http: HttpClient,
  jobId: string,
): Promise<GraphPrepareStatus> {
  const response = await http.get<unknown>(
    `${ROUTE_GRAPH_PREPARE}/${jobId}`,
  );

  if (!isGraphPrepareStatus(response)) {
    throw new Error(ERR_INVALID_GRAPH_PREPARE_STATUS);
  }

  return response;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function readGraphViewport(
  http: HttpClient,
  query: GraphViewportQuery,
): Promise<GraphViewportResponse> {
  const response = await http.post<GraphViewportQuery, unknown>(
    ROUTE_GRAPH_VIEWPORT,
    query,
  );

  if (!isGraphViewportResponse(response)) {
    throw new Error(ERR_INVALID_GRAPH_VIEWPORT_RESPONSE);
  }

  return response;
}

export async function readGraphRegion(
  http: HttpClient,
  query: GraphRegionQuery,
): Promise<GraphRegionResponse> {
  const response = await http.post<GraphRegionQuery, unknown>(
    ROUTE_GRAPH_REGION,
    query,
  );

  if (!isGraphRegionResponse(response)) {
    throw new Error(ERR_INVALID_GRAPH_REGION_RESPONSE);
  }

  return response;
}

export async function searchGraph(
  http: HttpClient,
  query: GraphSearchQuery,
): Promise<GraphSearchResponse> {
  const response = await http.post<GraphSearchQuery, unknown>(
    ROUTE_GRAPH_SEARCH,
    query,
  );

  if (!isGraphSearchResponse(response)) {
    throw new Error(ERR_INVALID_GRAPH_SEARCH_RESPONSE);
  }

  return response;
}

export function isGraphPrepareResponse(
  value: unknown,
): value is GraphPrepareResponse {
  return (
    isRecord(value) &&
    isString(value.dataset_id) &&
    isString(value.layout_version) &&
    isFiniteNumber(value.node_count) &&
    isFiniteNumber(value.edge_count) &&
    isFiniteNumber(value.cluster_count) &&
    isOptionalFiniteNumber(value.lod_tier_count) &&
    isGraphLayoutStatus(value.layout_status) &&
    isArrayOf(value.warnings, isString)
  );
}

export function isGraphPrepareJob(
  value: unknown,
): value is GraphPrepareJob {
  return (
    isRecord(value) &&
    isString(value.job_id) &&
    isString(value.status) &&
    isString(value.dataset_id)
  );
}

export function isGraphPrepareStatus(
  value: unknown,
): value is GraphPrepareStatus {
  return (
    isRecord(value) &&
    isString(value.job_id) &&
    isGraphPrepareJobStatus(value.status) &&
    (value.result === undefined ||
      value.result === null ||
      isGraphPrepareResponse(value.result)) &&
    isOptionalString(value.error)
  );
}

function isGraphPrepareJobStatus(
  value: unknown,
): value is GraphPrepareJobStatus {
  return value === "pending" || value === "ready" || value === "failed";
}

export function isGraphViewportResponse(
  value: unknown,
): value is GraphViewportResponse {
  return (
    isRecord(value) &&
    isString(value.dataset_id) &&
    isString(value.layout_version) &&
    isOptionalFiniteNumber(value.lod_level) &&
    isFiniteNumber(value.zoom) &&
    isGraphLayoutStatus(value.layout_status) &&
    isBoolean(value.truncated) &&
    isFiniteNumber(value.total_node_count) &&
    isArrayOf(value.nodes, isGraphViewportNode) &&
    isArrayOf(value.edges, isGraphViewportEdge) &&
    isOptionalGraphMetadataSchema(value.metadata_schema)
  );
}

export function isGraphRegionResponse(
  value: unknown,
): value is GraphRegionResponse {
  return (
    isRecord(value) &&
    isString(value.dataset_id) &&
    isString(value.layout_version) &&
    isGraphLayoutStatus(value.layout_status) &&
    isBoolean(value.truncated) &&
    isFiniteNumber(value.total_node_count) &&
    isArrayOf(value.nodes, isGraphViewportNode) &&
    isArrayOf(value.edges, isGraphViewportEdge) &&
    isOptionalGraphMetadataSchema(value.metadata_schema) &&
    isGraphAggregatedMetadata(value.aggregated_metadata)
  );
}

function isGraphAggregatedMetadata(
  value: unknown,
): value is Record<string, GraphMetadataValue> {
  return isRecord(value) && Object.values(value).every(isGraphMetadataValue);
}

export function isGraphSearchResponse(
  value: unknown,
): value is GraphSearchResponse {
  return (
    isRecord(value) &&
    isString(value.dataset_id) &&
    isString(value.query) &&
    isFiniteNumber(value.total_count) &&
    isArrayOf(value.matches, isGraphSearchMatch)
  );
}

function isGraphSearchMatch(value: unknown): value is GraphSearchMatch {
  return (
    isRecord(value) &&
    isString(value.node_id) &&
    isFiniteNumber(value.score) &&
    isString(value.matched_text)
  );
}

function isGraphViewportNode(value: unknown): value is GraphViewportNode {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.cluster_id) &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    isGraphLayoutStatus(value.layout_status) &&
    isFiniteNumber(value.member_count) &&
    isBoolean(value.is_representative) &&
    isOptionalGraphMetadata(value.metadata)
  );
}

function isGraphMetadataValue(
  value: unknown,
): value is GraphMetadataValue {
  return (
    value === null ||
    isString(value) ||
    isBoolean(value) ||
    isFiniteNumber(value)
  );
}

function isOptionalGraphMetadata(
  value: unknown,
): value is Record<string, GraphMetadataValue> | null | undefined {
  if (value === undefined || value === null) {
    return true;
  }

  return isRecord(value) && Object.values(value).every(isGraphMetadataValue);
}

function isGraphMetadataField(
  value: unknown,
): value is GraphMetadataField {
  return isRecord(value) && isString(value.key) && isString(value.type);
}

function isOptionalGraphMetadataSchema(
  value: unknown,
): value is GraphMetadataField[] | undefined {
  return value === undefined || isArrayOf(value, isGraphMetadataField);
}

function isGraphViewportEdge(value: unknown): value is GraphViewportEdge {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.source) &&
    isString(value.target) &&
    isOptionalFiniteNumber(value.distance) &&
    isOptionalBoolean(value.is_meta) &&
    isOptionalFiniteNumber(value.bundled_edge_count)
  );
}

function isGraphLayoutStatus(value: unknown): value is GraphLayoutStatus {
  return (
    isOptionalString(value) &&
    (value === "pending" ||
      value === "refining" ||
      value === "ready" ||
      value === "degraded" ||
      value === "failed")
  );
}
