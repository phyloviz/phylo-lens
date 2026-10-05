import type {
  GraphPrepareRequestDto,
  GraphViewportRequestDto,
  GraphRegionRequestDto,
  GraphSearchRequestDto,
  GraphAncillaryRequestDto,
} from "./dto/graph.dto";
import {
  toGraphPrepareRequestDto,
  toGraphPrepareJob,
  toGraphPrepareStatus,
  toGraphViewportRequestDto,
  toGraphViewportResult,
  toGraphRegionRequestDto,
  toGraphRegionResult,
  toGraphSearchRequestDto,
  toGraphSearchResult,
  toGraphAncillaryRequestDto,
  toGraphAncillaryResult,
} from "./graphMappers";
import { createHttpClient, type HttpClient } from "./httpClient";
import {
  isGraphAncillaryResponseDto,
  isGraphPrepareJobDto,
  isGraphPrepareStatusDto,
  isGraphRegionResponseDto,
  isGraphSearchResponseDto,
  isGraphViewportResponseDto,
  isGraphPrepareRequestDto,
  isServiceInformationDto,
} from "./graphGuards";
import {
  GraphPrepareJobStatus,
  type GraphAncillaryRequest,
  type GraphAncillaryResult,
  type GraphClient,
  type GraphPrepareResult,
  type GraphPrepareStatus,
  type GraphRegionRequest,
  type GraphRegionResult,
  type GraphSearchRequest,
  type GraphSearchResult,
  type GraphViewportRequest,
  type GraphViewportResult,
  type GraphPrepareRequest,
  type PrepareGraphOptions,
} from "../contracts/graph";
import {
  ERR_PHYLO_LENS_SERVICE_UNAVAILABLE,
  IncompatiblePhyloLensServiceError,
  PhyloLensServiceProtocolError,
  PhyloLensServiceUnavailableError,
} from "../services/serviceErrors";
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
): Promise<GraphPrepareResult> {
  await ensureCompatible();
  const job = await submitPrepareGraph(http, request);

  return pollPrepareGraph(http, job.jobId, options);
}

async function applyAncillaryData(http: HttpClient, request: GraphAncillaryRequest): Promise<GraphAncillaryResult> {
  const response = await http.put<GraphAncillaryRequestDto, unknown>(
    GRAPH_ROUTES.ancillary,
    toGraphAncillaryRequestDto(request),
  );
  if (!isGraphAncillaryResponseDto(response)) {
    throw new Error(GRAPH_API_ERRORS.invalidAncillaryResponse);
  }

  const result = toGraphAncillaryResult(response);
  if (result.datasetId !== request.datasetId) {
    throw new Error(GRAPH_API_ERRORS.invalidAncillaryResponse);
  }
  return result;
}

async function readGraphViewport(http: HttpClient, query: GraphViewportRequest): Promise<GraphViewportResult> {
  const response = await http.post<GraphViewportRequestDto, unknown>(
    GRAPH_ROUTES.viewport,
    toGraphViewportRequestDto(query),
  );

  if (!isGraphViewportResponseDto(response)) {
    throw new Error(GRAPH_API_ERRORS.invalidViewportResponse);
  }

  return toGraphViewportResult(response);
}

async function readGraphRegion(http: HttpClient, query: GraphRegionRequest): Promise<GraphRegionResult> {
  const response = await http.post<GraphRegionRequestDto, unknown>(GRAPH_ROUTES.region, toGraphRegionRequestDto(query));

  if (!isGraphRegionResponseDto(response)) {
    throw new Error(GRAPH_API_ERRORS.invalidRegionResponse);
  }

  return toGraphRegionResult(response);
}

async function searchGraph(http: HttpClient, query: GraphSearchRequest): Promise<GraphSearchResult> {
  const response = await http.post<GraphSearchRequestDto, unknown>(GRAPH_ROUTES.search, toGraphSearchRequestDto(query));

  if (!isGraphSearchResponseDto(response)) {
    throw new Error(GRAPH_API_ERRORS.invalidSearchResponse);
  }

  return toGraphSearchResult(response);
}

// Helpers

async function submitPrepareGraph(http: HttpClient, request: GraphPrepareRequest) {
  const dto = toGraphPrepareRequestDto(request);
  if (!isGraphPrepareRequestDto(dto)) {
    throw new Error(GRAPH_API_ERRORS.invalidPrepareRequest);
  }

  const response = await http.post<GraphPrepareRequestDto, unknown>(GRAPH_ROUTES.prepare, dto);

  if (!isGraphPrepareJobDto(response)) {
    throw new Error(GRAPH_API_ERRORS.invalidPrepareJob);
  }

  return toGraphPrepareJob(response);
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

  if (!isServiceInformationDto(response)) {
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
): Promise<GraphPrepareResult> {
  const intervalMs = options.pollIntervalMs ?? DEFAULT_PREPARE_POLL_INTERVAL_MS;
  const timeoutMs = options.pollTimeoutMs ?? DEFAULT_PREPARE_POLL_TIMEOUT_MS;
  const sleep = options.sleep ?? delay;
  const deadline = timeoutMs === null ? null : Date.now() + timeoutMs;

  for (;;) {
    const status: GraphPrepareStatus = await getPrepareGraphStatus(http, jobId);

    if (status.status === GraphPrepareJobStatus.READY) {
      if (status.result == null) {
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
  const response = await http.get<unknown>(GRAPH_ROUTES.prepareStatus(jobId));

  if (!isGraphPrepareStatusDto(response)) {
    throw new Error(GRAPH_API_ERRORS.invalidPrepareStatus);
  }

  return toGraphPrepareStatus(response);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
