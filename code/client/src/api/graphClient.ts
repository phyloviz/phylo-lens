import { createHttpClient, type HttpClient } from "./httpClient";
import {
  isGraphAncillaryResponse,
  isGraphPrepareJob,
  isGraphPrepareResponse,
  isGraphPrepareStatus,
  isGraphRegionResponse,
  isGraphSearchResponse,
  isGraphViewportResponse,
  isNormalizeRequest,
} from "./graphGuards";
import {
  GraphPrepareJobStatus,
  type GraphAncillaryRequest,
  type GraphAncillaryResponse,
  type GraphClient,
  type GraphPrepareResponse,
  type GraphPrepareStatus,
  type GraphRegionQuery,
  type GraphRegionResponse,
  type GraphSearchQuery,
  type GraphSearchResponse,
  type GraphViewportQuery,
  type GraphViewportResponse,
  type NormalizeRequest,
  type PrepareGraphOptions,
} from "./graphContracts";
import {
  ERR_PHYLO_LENS_SERVICE_UNAVAILABLE,
  IncompatiblePhyloLensServiceError,
  PhyloLensServiceProtocolError,
  PhyloLensServiceUnavailableError,
} from "../services/serviceErrors";
import { isServiceInformation } from "../services/serviceGuards";

// Routes
export const ROUTE_SERVICE_HEALTH = "/health";
export const ROUTE_GRAPH_PREPARE = "/api/graph/prepare";
export const ROUTE_GRAPH_VIEWPORT = "/api/graph/viewport";
export const ROUTE_GRAPH_REGION = "/api/graph/region";
export const ROUTE_GRAPH_SEARCH = "/api/graph/search";

// Error messages
export const ERR_INVALID_GRAPH_PREPARE_RESPONSE = "Invalid graph prepare response contract.";
export const ERR_INVALID_GRAPH_PREPARE_JOB = "Invalid graph prepare job contract.";
export const ERR_INVALID_GRAPH_PREPARE_STATUS = "Invalid graph prepare status contract.";
export const ERR_GRAPH_PREPARE_FAILED = "Graph layout preparation failed.";
export const ERR_GRAPH_PREPARE_TIMED_OUT = "Graph layout preparation did not complete in time.";
export const ERR_INVALID_GRAPH_VIEWPORT_RESPONSE = "Invalid graph viewport response contract.";
export const ERR_INVALID_GRAPH_REGION_RESPONSE = "Invalid graph region response contract.";
export const ERR_INVALID_GRAPH_SEARCH_RESPONSE = "Invalid graph search response contract.";
export const ERR_INVALID_NORMALIZE_REQUEST = "Invalid graph normalize request contract.";
export const ERR_INVALID_GRAPH_ANCILLARY_PREPARE_RESPONSE = "Invalid graph ancillary response contract.";

export const SUPPORTED_PHYLO_LENS_API_VERSION = "1";

// Default polling intervals and timeouts
export const DEFAULT_PREPARE_POLL_INTERVAL_MS = 1000;
export const DEFAULT_PREPARE_POLL_TIMEOUT_MS: number | null = null;

export interface GraphClientOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch; //TODO: Review this, not sure if it makes sense.
}

export function createGraphClient(options: GraphClientOptions): GraphClient {
  const http = createHttpClient(options);

  return {
    prepareGraph: (request, options) => prepareGraph(http, request, options),
    applyAncillaryData: (request) => applyAncillaryData(http, request),
    readViewport: (query) => readGraphViewport(http, query),
    readRegion: (query) => readGraphRegion(http, query),
    searchGraph: (query) => searchGraph(http, query),
  };
}

async function prepareGraph(
  http: HttpClient,
  request: NormalizeRequest,
  options: PrepareGraphOptions = {},
  ensureCompatible: () => Promise<void> = () => checkAPIService(http),
): Promise<GraphPrepareResponse> {
  await ensureCompatible();
  const job = await submitPrepareGraph(http, request);

  return pollPrepareGraph(http, job.job_id, options);
}

async function applyAncillaryData(http: HttpClient, request: GraphAncillaryRequest): Promise<GraphAncillaryResponse> {
  const response = await http.put<GraphAncillaryRequest, unknown>("/api/graph/ancillary", request); //TODO: Have a common place for backend API URIs

  if (!isGraphAncillaryResponse(response) || response.dataset_id !== request.dataset_id) {
    throw new Error(ERR_INVALID_GRAPH_ANCILLARY_PREPARE_RESPONSE);
  }

  return response;
}

async function readGraphViewport(http: HttpClient, query: GraphViewportQuery): Promise<GraphViewportResponse> {
  const response = await http.post<GraphViewportQuery, unknown>(ROUTE_GRAPH_VIEWPORT, query);

  if (!isGraphViewportResponse(response)) {
    throw new Error(ERR_INVALID_GRAPH_VIEWPORT_RESPONSE);
  }

  return response;
}

async function readGraphRegion(http: HttpClient, query: GraphRegionQuery): Promise<GraphRegionResponse> {
  const response = await http.post<GraphRegionQuery, unknown>(ROUTE_GRAPH_REGION, query);

  if (!isGraphRegionResponse(response)) {
    throw new Error(ERR_INVALID_GRAPH_REGION_RESPONSE);
  }

  return response;
}

async function searchGraph(http: HttpClient, query: GraphSearchQuery): Promise<GraphSearchResponse> {
  const response = await http.post<GraphSearchQuery, unknown>(ROUTE_GRAPH_SEARCH, query);

  if (!isGraphSearchResponse(response)) {
    throw new Error(ERR_INVALID_GRAPH_SEARCH_RESPONSE);
  }

  return response;
}

// Helpers

async function submitPrepareGraph(http: HttpClient, request: NormalizeRequest) {
  if (!isNormalizeRequest(request)) {
    throw new Error(ERR_INVALID_NORMALIZE_REQUEST);
  }

  const response = await http.post<NormalizeRequest, unknown>(ROUTE_GRAPH_PREPARE, request);

  if (!isGraphPrepareJob(response)) {
    throw new Error(ERR_INVALID_GRAPH_PREPARE_JOB);
  }

  return response;
}

async function checkAPIService(http: HttpClient): Promise<void> {
  let response: unknown;

  try {
    response = await http.get<unknown>(ROUTE_SERVICE_HEALTH);
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new PhyloLensServiceProtocolError(undefined, { cause: error });
    }

    throw new PhyloLensServiceUnavailableError(serviceUnavailableMessage(error), {
      cause: error,
    });
  }

  if (!isServiceInformation(response)) {
    throw new PhyloLensServiceProtocolError();
  }

  if (response.api_version !== SUPPORTED_PHYLO_LENS_API_VERSION) {
    throw new IncompatiblePhyloLensServiceError(SUPPORTED_PHYLO_LENS_API_VERSION, response.api_version);
  }
}

function serviceUnavailableMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return `${ERR_PHYLO_LENS_SERVICE_UNAVAILABLE} ${error.message}`;
  }

  return ERR_PHYLO_LENS_SERVICE_UNAVAILABLE;
}

async function pollPrepareGraph(
  http: HttpClient,
  jobId: string,
  options: PrepareGraphOptions,
): Promise<GraphPrepareResponse> {
  const intervalMs = options.pollIntervalMs ?? DEFAULT_PREPARE_POLL_INTERVAL_MS;
  const timeoutMs = options.pollTimeoutMs ?? DEFAULT_PREPARE_POLL_TIMEOUT_MS;
  const sleep = options.sleep ?? delay;
  const deadline = timeoutMs === null ? null : Date.now() + timeoutMs;

  for (;;) {
    const status: GraphPrepareStatus = await getPrepareGraphStatus(http, jobId);

    if (status.status === GraphPrepareJobStatus.READY) {
      if (!isGraphPrepareResponse(status.result)) {
        throw new Error(ERR_INVALID_GRAPH_PREPARE_RESPONSE);
      }

      return status.result;
    }

    if (status.status === GraphPrepareJobStatus.FAILED) {
      throw new Error(status.error ?? ERR_GRAPH_PREPARE_FAILED);
    }

    options.onPending?.(status);

    if (deadline !== null && Date.now() >= deadline) {
      throw new Error(ERR_GRAPH_PREPARE_TIMED_OUT);
    }

    await sleep(intervalMs);
  }
}

export async function getPrepareGraphStatus(http: HttpClient, jobId: string): Promise<GraphPrepareStatus> {
  const response = await http.get<unknown>(`${ROUTE_GRAPH_PREPARE}/${jobId}`); //TODO: Add a DTO of the API Service Response...

  if (!isGraphPrepareStatus(response)) {
    throw new Error(ERR_INVALID_GRAPH_PREPARE_STATUS);
  }

  return response;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
