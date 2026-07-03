import {
  isArrayOf,
  isBoolean,
  isFiniteNumber,
  isOptionalFiniteNumber,
  isOptionalString,
  isRecord,
  isString,
} from "../validation/guards";
import { SOURCE_FORMAT_NEWICK } from "../contracts/models";
import { createHttpClient, type HttpClient } from "./httpClient";

export const ROUTE_GRAPH_V2_PREPARE = "/api/v2/graph/prepare";
export const ROUTE_GRAPH_V2_VIEWPORT = "/api/v2/graph/viewport";
export const ERR_INVALID_GRAPH_V2_PREPARE_RESPONSE =
  "Invalid graph v2 prepare response contract.";
export const ERR_INVALID_GRAPH_V2_VIEWPORT_RESPONSE =
  "Invalid graph v2 viewport response contract.";

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
  layout_status: GraphV2LayoutStatus;
  warnings: string[];
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

export interface GraphV2ClientOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
}

export interface GraphV2Client {
  prepareGraph: (request: NormalizeRequest) => Promise<GraphV2PrepareResponse>;
  readViewport: (
    query: GraphV2ViewportQuery,
  ) => Promise<GraphV2ViewportResponse>;
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
    prepareGraph: (request) => prepareGraphV2(http, request),
    readViewport: (query) => readGraphV2Viewport(http, query),
  };
}

export async function prepareGraphV2(
  http: HttpClient,
  request: NormalizeRequest,
): Promise<GraphV2PrepareResponse> {
  const response = await http.post<NormalizeRequest, unknown>(
    ROUTE_GRAPH_V2_PREPARE,
    request,
  );

  if (!isGraphV2PrepareResponse(response)) {
    throw new Error(ERR_INVALID_GRAPH_V2_PREPARE_RESPONSE);
  }

  return response;
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
    isGraphV2LayoutStatus(value.layout_status) &&
    isArrayOf(value.warnings, isString)
  );
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
    isOptionalFiniteNumber(value.distance)
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
