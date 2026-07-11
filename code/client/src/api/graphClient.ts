import { createHttpClient, type HttpClient } from "./httpClient";
import {
  isGraphPrepareJob,
  isGraphPrepareResponse,
  isGraphPrepareStatus,
  isGraphRegionResponse,
  isGraphSearchResponse,
  isGraphViewportResponse,
} from "./graphGuards";
import type {
  GraphPrepareResponse,
  GraphPrepareStatus,
  GraphRegionQuery,
  GraphRegionResponse,
  GraphSearchQuery,
  GraphSearchResponse,
  GraphViewportQuery,
  GraphViewportResponse,
  NormalizeRequest,
} from "./graphContracts";

// Routes
export const ROUTE_GRAPH_PREPARE = "/api/graph/prepare";
export const ROUTE_GRAPH_VIEWPORT = "/api/graph/viewport";
export const ROUTE_GRAPH_REGION = "/api/graph/region";
export const ROUTE_GRAPH_SEARCH = "/api/graph/search";

// Error messages
export const ERR_INVALID_GRAPH_PREPARE_RESPONSE =
  "Invalid graph prepare response contract.";
export const ERR_INVALID_GRAPH_PREPARE_JOB =
  "Invalid graph prepare job contract.";
export const ERR_INVALID_GRAPH_PREPARE_STATUS =
  "Invalid graph prepare status contract.";
export const ERR_GRAPH_PREPARE_FAILED = "Graph layout preparation failed.";
export const ERR_GRAPH_PREPARE_TIMED_OUT =
  "Graph layout preparation did not complete in time.";
export const ERR_INVALID_GRAPH_VIEWPORT_RESPONSE =
  "Invalid graph viewport response contract.";
export const ERR_INVALID_GRAPH_REGION_RESPONSE =
  "Invalid graph region response contract.";
export const ERR_INVALID_GRAPH_SEARCH_RESPONSE =
  "Invalid graph search response contract.";

// Default polling intervals and timeouts
export const DEFAULT_PREPARE_POLL_INTERVAL_MS = 1000;
export const DEFAULT_PREPARE_POLL_TIMEOUT_MS = 600_000;

export interface PrepareGraphOptions {
  onPending?: (status: GraphPrepareStatus) => void;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface GraphClientOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
}

export type GraphClient = ReturnType<typeof createGraphClient>;

export function createGraphClient(options: GraphClientOptions) {
  const http = createHttpClient(options);

  return {
    prepareGraph: (
      request: NormalizeRequest,
      prepareOptions?: PrepareGraphOptions,
    ) => prepareGraph(http, request, prepareOptions),

    readViewport: (query: GraphViewportQuery) => readGraphViewport(http, query),

    readRegion: (query: GraphRegionQuery) => readGraphRegion(http, query),

    searchGraph: (query: GraphSearchQuery) => searchGraph(http, query),
  };
}

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
) {
  const response = await http.post<NormalizeRequest, unknown>(
    ROUTE_GRAPH_PREPARE,
    request,
  );

  if (!isGraphPrepareJob(response)) {
    throw new Error(ERR_INVALID_GRAPH_PREPARE_JOB);
  }

  return response;
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
  const response = await http.get<unknown>(`${ROUTE_GRAPH_PREPARE}/${jobId}`);

  if (!isGraphPrepareStatus(response)) {
    throw new Error(ERR_INVALID_GRAPH_PREPARE_STATUS);
  }

  return response;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
