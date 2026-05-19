import {
  type NormalizeResponse,
  type PrepareDatasetResponse,
  SOURCE_FORMAT_EDGELIST,
  SOURCE_FORMAT_NEWICK,
  type VisibleSliceQuery,
  type VisibleSliceResponse,
} from "../contracts/models";
import {
  isNormalizeResponse,
  isPrepareDatasetResponse,
  isVisibleSliceResponse,
} from "../validation/datasetGuards";
import { createHttpClient, type HttpClient } from "./httpClient";

export const ROUTE_NORMALIZE = "/dataset/normalize";
export const ROUTE_PREPARE = "/dataset/prepare";
export const ROUTE_VIEW_SLICE = "/dataset/view-slice";

export const ERR_INVALID_RESPONSE = "Invalid normalize response contract.";
export const ERR_INVALID_PREPARE_RESPONSE =
  "Invalid prepare dataset response contract.";
export const ERR_INVALID_VISIBLE_SLICE_RESPONSE =
  "Invalid visible slice response contract.";

export interface NormalizeRequest {
  format: typeof SOURCE_FORMAT_NEWICK | typeof SOURCE_FORMAT_EDGELIST;
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
}

export interface DatasetClientOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
}

export interface DatasetClient {
  normalizeDataset: (request: NormalizeRequest) => Promise<NormalizeResponse>;
  prepareDataset: (
    request: NormalizeRequest,
  ) => Promise<PrepareDatasetResponse>;
  viewSlice: (request: VisibleSliceQuery) => Promise<VisibleSliceResponse>;
}

export function createDatasetClient(
  options: DatasetClientOptions,
): DatasetClient {
  const http = createHttpClient({
    baseUrl: options.baseUrl,
    fetchImpl: options.fetchImpl,
  });

  return createDatasetClientFromHttp(http);
}

export function createDatasetClientFromHttp(http: HttpClient): DatasetClient {
  return {
    normalizeDataset: (request) => normalizeDataset(http, request),
    prepareDataset: (request) => prepareDataset(http, request),
    viewSlice: (request) => viewSlice(http, request),
  };
}

export async function normalizeDataset(
  http: HttpClient,
  request: NormalizeRequest,
): Promise<NormalizeResponse> {
  const response = await http.post<NormalizeRequest, unknown>(
    ROUTE_NORMALIZE,
    request,
  );

  if (!isNormalizeResponse(response)) {
    throw new Error(ERR_INVALID_RESPONSE);
  }

  return response;
}

export async function prepareDataset(
  http: HttpClient,
  request: NormalizeRequest,
): Promise<PrepareDatasetResponse> {
  const response = await http.post<NormalizeRequest, unknown>(
    ROUTE_PREPARE,
    request,
  );

  if (!isPrepareDatasetResponse(response)) {
    throw new Error(ERR_INVALID_PREPARE_RESPONSE);
  }

  return response;
}

export async function viewSlice(
  http: HttpClient,
  request: VisibleSliceQuery,
): Promise<VisibleSliceResponse> {
  const response = await http.post<VisibleSliceQuery, unknown>(
    ROUTE_VIEW_SLICE,
    request,
  );

  if (!isVisibleSliceResponse(response)) {
    throw new Error(ERR_INVALID_VISIBLE_SLICE_RESPONSE);
  }

  return response;
}
