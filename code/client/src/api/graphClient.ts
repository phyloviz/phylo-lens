import { createHttpClient, type HttpClient } from "./httpClient";
import {
  isGraphAncillaryResponse,
  isGraphPrepareJob,
  isGraphPrepareResponse,
  isGraphPrepareStatus,
  isGraphRegionResponse,
  isGraphSearchResponse,
  isGraphViewportResponse,
  isGraphPrepareRequest,
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
  type GraphPrepareRequest,
  type PrepareGraphOptions,
} from "./graphContracts";
import {
  ERR_PHYLO_LENS_SERVICE_UNAVAILABLE,
  IncompatiblePhyloLensServiceError,
  PhyloLensServiceProtocolError,
  PhyloLensServiceUnavailableError,
} from "../services/serviceErrors";
import { isServiceInformation } from "../services/serviceGuards";
import { GRAPH_ROUTES } from "./graphRoutes";
import { GRAPH_API_ERRORS } from "./graphErrors";

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
  request: GraphPrepareRequest,
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
    throw new Error(GRAPH_API_ERRORS.invalidAncillaryResponse);
  }

  return response;
}

async function readGraphViewport(http: HttpClient, query: GraphViewportQuery): Promise<GraphViewportResponse> {
  const response = await http.post<GraphViewportQuery, unknown>(GRAPH_ROUTES.viewport, query);

  if (!isGraphViewportResponse(response)) {
    throw new Error(GRAPH_API_ERRORS.invalidViewportResponse);
  }

  return response;
}

async function readGraphRegion(http: HttpClient, query: GraphRegionQuery): Promise<GraphRegionResponse> {
  const response = await http.post<GraphRegionQuery, unknown>(GRAPH_ROUTES.region, query);

  if (!isGraphRegionResponse(response)) {
    throw new Error(GRAPH_API_ERRORS.invalidRegionResponse);
  }

  return response;
}

async function searchGraph(http: HttpClient, query: GraphSearchQuery): Promise<GraphSearchResponse> {
  const response = await http.post<GraphSearchQuery, unknown>(GRAPH_ROUTES.search, query);

  if (!isGraphSearchResponse(response)) {
    throw new Error(GRAPH_API_ERRORS.invalidSearchResponse);
  }

  return response;
}

// Helpers

async function submitPrepareGraph(http: HttpClient, request: GraphPrepareRequest) {
  if (!isGraphPrepareRequest(request)) {
    throw new Error(GRAPH_API_ERRORS.invalidGraphPrepareRequest);
  }

  const response = await http.post<GraphPrepareRequest, unknown>(GRAPH_ROUTES.prepare, request);

  if (!isGraphPrepareJob(response)) {
    throw new Error(GRAPH_API_ERRORS.invalidPrepareJob);
  }

  return response;
}

async function checkAPIService(http: HttpClient): Promise<void> {
  let response: unknown;

  try {
    response = await http.get<unknown>(GRAPH_ROUTES.health);
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
        throw new Error(GRAPH_API_ERRORS.invalidPrepareResponse);
      }

      return status.result;
    }

    if (status.status === GraphPrepareJobStatus.FAILED) {
      throw new Error(status.error ?? GRAPH_API_ERRORS.prepareFailed);
    }

    options.onPending?.(status);

    if (deadline !== null && Date.now() >= deadline) {
      throw new Error(GRAPH_API_ERRORS.prepareTimedOut);
    }

    await sleep(intervalMs);
  }
}

export async function getPrepareGraphStatus(http: HttpClient, jobId: string): Promise<GraphPrepareStatus> {
  const response = await http.get<unknown>(`${GRAPH_ROUTES.prepare}/${jobId}`);

  if (!isGraphPrepareStatus(response)) {
    throw new Error(GRAPH_API_ERRORS.invalidPrepareStatus);
  }

  return response;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
