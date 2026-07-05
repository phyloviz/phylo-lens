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
import { SOURCE_FORMAT_NEWICK } from "../contracts/models";
import { createHttpClient, type HttpClient } from "./httpClient";

export const ROUTE_GRAPH_V2_PREPARE = "/api/v2/graph/prepare";
export const ROUTE_GRAPH_V2_VIEWPORT = "/api/v2/graph/viewport";
export const ROUTE_GRAPH_V2_REGION = "/api/v2/graph/region";
export const ERR_INVALID_GRAPH_V2_PREPARE_RESPONSE = "Invalid graph v2 prepare response contract.";
export const ERR_INVALID_GRAPH_V2_PREPARE_JOB = "Invalid graph v2 prepare job contract.";
export const ERR_INVALID_GRAPH_V2_PREPARE_STATUS = "Invalid graph v2 prepare status contract.";
export const ERR_GRAPH_V2_PREPARE_FAILED = "Graph v2 layout preparation failed.";
export const ERR_GRAPH_V2_PREPARE_TIMED_OUT = "Graph v2 layout preparation did not complete in time.";
export const ERR_INVALID_GRAPH_V2_VIEWPORT_RESPONSE = "Invalid graph v2 viewport response contract.";
export const ERR_INVALID_GRAPH_V2_REGION_RESPONSE = "Invalid graph v2 region response contract.";

// Layout runs on a background worker, so /prepare returns a job the client polls
// at /prepare/{job_id} until it is ready. These govern the polling cadence and
// budget; large trees can take a while, so the ceiling is generous.
export const DEFAULT_PREPARE_POLL_INTERVAL_MS = 1000;
export const DEFAULT_PREPARE_POLL_TIMEOUT_MS = 600_000;

export type GraphV2PrepareJobStatus = "pending" | "ready" | "failed";

export type GraphV2LayoutStatus = "pending" | "refining" | "ready" | "failed";

export type GraphV2MetadataValue = string | number | boolean | null;

export interface GraphV2MetadataField {
  key: string;
  type: string;
}

export interface NormalizeRequest {
  format: typeof SOURCE_FORMAT_NEWICK;
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

export interface GraphV2ViewportQuery {
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

export interface GraphV2PrepareResponse {
  dataset_id: string;
  layout_version: string;
  node_count: number;
  edge_count: number;
  cluster_count: number;
  // Number of precomputed LoD tiers (distinct distance thresholds) the client
  // can map camera zoom onto. Optional for backward compatibility; treated as 1
  // (finest detail only) when absent.
  lod_tier_count?: number;
  layout_status: GraphV2LayoutStatus;
  warnings: string[];
}

export interface GraphV2PrepareJob {
  job_id: string;
  status: string;
  dataset_id: string;
}

export interface GraphV2PrepareStatus {
  job_id: string;
  status: GraphV2PrepareJobStatus;
  result?: GraphV2PrepareResponse | null;
  error?: string | null;
}

export interface GraphV2ViewportNode {
  id: string;
  cluster_id: string;
  x: number;
  y: number;
  layout_status: GraphV2LayoutStatus;
  member_count: number;
  is_representative: boolean;
  metadata?: Record<string, GraphV2MetadataValue> | null;
}

export interface GraphV2ViewportEdge {
  id: string;
  source: string;
  target: string;
  distance?: number | null;
  // Meta-edge fields. Present only for rerouted boundary edges of an expanded
  // cluster; ordinary edges omit them (server excludes null values).
  is_meta?: boolean | null;
  bundled_edge_count?: number | null;
}

export interface GraphV2ViewportResponse {
  dataset_id: string;
  layout_version: string;
  lod_level?: number | null;
  zoom: number;
  layout_status: GraphV2LayoutStatus;
  truncated: boolean;
  total_node_count: number;
  nodes: GraphV2ViewportNode[];
  edges: GraphV2ViewportEdge[];
  metadata_schema?: GraphV2MetadataField[];
}

export interface GraphV2RegionQuery {
  dataset_id: string;
  layout_version?: string | null;
  xmin: number;
  xmax: number;
  ymin: number;
  ymax: number;
  max_nodes?: number;
}

export interface GraphV2RegionResponse {
  dataset_id: string;
  layout_version: string;
  layout_status: GraphV2LayoutStatus;
  truncated: boolean;
  total_node_count: number;
  nodes: GraphV2ViewportNode[];
  edges: GraphV2ViewportEdge[];
  metadata_schema?: GraphV2MetadataField[];
  // One aggregated value per metadata field across the selected members
  // (mean for numeric fields, mode for everything else).
  aggregated_metadata: Record<string, GraphV2MetadataValue>;
}

export interface PrepareGraphOptions {
  // Notified on each poll while the background layout job is still pending, so a
  // caller can drive a progress indicator. Fired once per poll attempt.
  onPending?: (job: GraphV2PrepareStatus) => void;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
  // Injectable for tests; defaults to setTimeout-based delay.
  sleep?: (ms: number) => Promise<void>;
}

export interface GraphV2ClientOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
}

export interface GraphV2Client {
  prepareGraph: (
    request: NormalizeRequest,
    options?: PrepareGraphOptions,
  ) => Promise<GraphV2PrepareResponse>;
  readViewport: (query: GraphV2ViewportQuery,) => Promise<GraphV2ViewportResponse>;
  readRegion: (query: GraphV2RegionQuery) => Promise<GraphV2RegionResponse>;
}

export function createGraphV2Client(options: GraphV2ClientOptions): GraphV2Client {
  return createGraphV2ClientFromHttp(
    createHttpClient({
      baseUrl: options.baseUrl,
      fetchImpl: options.fetchImpl,
    }),
  );
}

export function createGraphV2ClientFromHttp(http: HttpClient): GraphV2Client {
  return {
    prepareGraph: (request, options) => prepareGraphV2(http, request, options),
    readViewport: (query) => readGraphV2Viewport(http, query),
    readRegion: (query) => readGraphV2Region(http, query),
  };
}

// Submit a background layout job, then poll its status until it resolves. The
// public return type stays GraphV2PrepareResponse so callers are unaffected by
// the async transport — the polling is fully encapsulated here.
export async function prepareGraphV2(
  http: HttpClient,
  request: NormalizeRequest,
  options: PrepareGraphOptions = {},
): Promise<GraphV2PrepareResponse> {
  const job = await submitPrepareGraphV2(http, request);
  return pollPrepareGraphV2(http, job.job_id, options);
}

export async function submitPrepareGraphV2(
  http: HttpClient,
  request: NormalizeRequest,
): Promise<GraphV2PrepareJob> {
  const response = await http.post<NormalizeRequest, unknown>(
    ROUTE_GRAPH_V2_PREPARE,
    request,
  );

  if (!isGraphV2PrepareJob(response)) {
    throw new Error(ERR_INVALID_GRAPH_V2_PREPARE_JOB);
  }

  return response;
}

async function pollPrepareGraphV2(
  http: HttpClient,
  jobId: string,
  options: PrepareGraphOptions,
): Promise<GraphV2PrepareResponse> {
  const intervalMs = options.pollIntervalMs ?? DEFAULT_PREPARE_POLL_INTERVAL_MS;
  const timeoutMs = options.pollTimeoutMs ?? DEFAULT_PREPARE_POLL_TIMEOUT_MS;
  const sleep = options.sleep ?? defaultSleep;
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const status = await getPrepareGraphV2Status(http, jobId);

    if (status.status === "ready") {
      if (!isGraphV2PrepareResponse(status.result)) {
        throw new Error(ERR_INVALID_GRAPH_V2_PREPARE_RESPONSE);
      }
      return status.result;
    }
    if (status.status === "failed") {
      throw new Error(status.error ?? ERR_GRAPH_V2_PREPARE_FAILED);
    }

    options.onPending?.(status);

    if (Date.now() >= deadline) {
      throw new Error(ERR_GRAPH_V2_PREPARE_TIMED_OUT);
    }
    await sleep(intervalMs);
  }
}

export async function getPrepareGraphV2Status(
  http: HttpClient,
  jobId: string,
): Promise<GraphV2PrepareStatus> {
  const response = await http.get<unknown>(
    `${ROUTE_GRAPH_V2_PREPARE}/${jobId}`,
  );

  if (!isGraphV2PrepareStatus(response)) {
    throw new Error(ERR_INVALID_GRAPH_V2_PREPARE_STATUS);
  }

  return response;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function readGraphV2Viewport(
  http: HttpClient,
  query: GraphV2ViewportQuery,
): Promise<GraphV2ViewportResponse> {
  const response = await http.post<GraphV2ViewportQuery, unknown>(
    ROUTE_GRAPH_V2_VIEWPORT,
    query,
  );

  if (!isGraphV2ViewportResponse(response)) {
    throw new Error(ERR_INVALID_GRAPH_V2_VIEWPORT_RESPONSE);
  }

  return response;
}

export async function readGraphV2Region(
  http: HttpClient,
  query: GraphV2RegionQuery,
): Promise<GraphV2RegionResponse> {
  const response = await http.post<GraphV2RegionQuery, unknown>(
    ROUTE_GRAPH_V2_REGION,
    query,
  );

  if (!isGraphV2RegionResponse(response)) {
    throw new Error(ERR_INVALID_GRAPH_V2_REGION_RESPONSE);
  }

  return response;
}

export function isGraphV2PrepareResponse(
  value: unknown,
): value is GraphV2PrepareResponse {
  return (
    isRecord(value) &&
    isString(value.dataset_id) &&
    isString(value.layout_version) &&
    isFiniteNumber(value.node_count) &&
    isFiniteNumber(value.edge_count) &&
    isFiniteNumber(value.cluster_count) &&
    isOptionalFiniteNumber(value.lod_tier_count) &&
    isGraphV2LayoutStatus(value.layout_status) &&
    isArrayOf(value.warnings, isString)
  );
}

export function isGraphV2PrepareJob(
  value: unknown,
): value is GraphV2PrepareJob {
  return (
    isRecord(value) &&
    isString(value.job_id) &&
    isString(value.status) &&
    isString(value.dataset_id)
  );
}

export function isGraphV2PrepareStatus(
  value: unknown,
): value is GraphV2PrepareStatus {
  return (
    isRecord(value) &&
    isString(value.job_id) &&
    isGraphV2PrepareJobStatus(value.status) &&
    (value.result === undefined ||
      value.result === null ||
      isGraphV2PrepareResponse(value.result)) &&
    isOptionalString(value.error)
  );
}

function isGraphV2PrepareJobStatus(
  value: unknown,
): value is GraphV2PrepareJobStatus {
  return value === "pending" || value === "ready" || value === "failed";
}

export function isGraphV2ViewportResponse(
  value: unknown,
): value is GraphV2ViewportResponse {
  return (
    isRecord(value) &&
    isString(value.dataset_id) &&
    isString(value.layout_version) &&
    isOptionalFiniteNumber(value.lod_level) &&
    isFiniteNumber(value.zoom) &&
    isGraphV2LayoutStatus(value.layout_status) &&
    isBoolean(value.truncated) &&
    isFiniteNumber(value.total_node_count) &&
    isArrayOf(value.nodes, isGraphV2ViewportNode) &&
    isArrayOf(value.edges, isGraphV2ViewportEdge) &&
    isOptionalGraphV2MetadataSchema(value.metadata_schema)
  );
}

export function isGraphV2RegionResponse(
  value: unknown,
): value is GraphV2RegionResponse {
  return (
    isRecord(value) &&
    isString(value.dataset_id) &&
    isString(value.layout_version) &&
    isGraphV2LayoutStatus(value.layout_status) &&
    isBoolean(value.truncated) &&
    isFiniteNumber(value.total_node_count) &&
    isArrayOf(value.nodes, isGraphV2ViewportNode) &&
    isArrayOf(value.edges, isGraphV2ViewportEdge) &&
    isOptionalGraphV2MetadataSchema(value.metadata_schema) &&
    isGraphV2AggregatedMetadata(value.aggregated_metadata)
  );
}

function isGraphV2AggregatedMetadata(
  value: unknown,
): value is Record<string, GraphV2MetadataValue> {
  return isRecord(value) && Object.values(value).every(isGraphV2MetadataValue);
}

function isGraphV2ViewportNode(value: unknown): value is GraphV2ViewportNode {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.cluster_id) &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    isGraphV2LayoutStatus(value.layout_status) &&
    isFiniteNumber(value.member_count) &&
    isBoolean(value.is_representative) &&
    isOptionalGraphV2Metadata(value.metadata)
  );
}

function isGraphV2MetadataValue(
  value: unknown,
): value is GraphV2MetadataValue {
  return (
    value === null ||
    isString(value) ||
    isBoolean(value) ||
    isFiniteNumber(value)
  );
}

function isOptionalGraphV2Metadata(
  value: unknown,
): value is Record<string, GraphV2MetadataValue> | null | undefined {
  if (value === undefined || value === null) {
    return true;
  }

  return isRecord(value) && Object.values(value).every(isGraphV2MetadataValue);
}

function isGraphV2MetadataField(
  value: unknown,
): value is GraphV2MetadataField {
  return isRecord(value) && isString(value.key) && isString(value.type);
}

function isOptionalGraphV2MetadataSchema(
  value: unknown,
): value is GraphV2MetadataField[] | undefined {
  return value === undefined || isArrayOf(value, isGraphV2MetadataField);
}

function isGraphV2ViewportEdge(value: unknown): value is GraphV2ViewportEdge {
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

function isGraphV2LayoutStatus(value: unknown): value is GraphV2LayoutStatus {
  return (
    isOptionalString(value) &&
    (value === "pending" ||
      value === "refining" ||
      value === "ready" ||
      value === "failed")
  );
}
