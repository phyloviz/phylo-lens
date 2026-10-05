import type { GraphPrepareJobDto } from './models/prepare/GraphPrepareJobDto';
import type { GraphPrepareStatusDto } from './models/prepare/GraphPrepareStatusDto';
import type { HttpClient } from '../httpClient';
import type { GraphPrepareRequest } from '../../contracts/graph/prepare/GraphPrepareRequest';
import type { GraphPrepareOptions } from '../../contracts/graph/prepare/GraphPrepareOptions';
import { checkAPIService } from './serviceInformationService';
import type { GraphPrepareResult } from '../../contracts/graph/prepare/GraphPrepareResult';
import {
    toGraphPrepareRequestDto,
    copyGraphPrepareRequestDto,
    toGraphPrepareJob,
    toGraphPrepareStatus,
} from './mappers/graphPrepareMappers';
import { isGraphPrepareRequestDto, isGraphPrepareJobDto, isGraphPrepareStatusDto } from './guards/graphPrepareGuards';
import { GRAPH_API_ERRORS } from './graphErrors';
import type { GraphPrepareRequestDto } from './models/prepare/GraphPrepareRequestDto';
import { GRAPH_ROUTES } from './graphRoutes';
import type { GraphPrepareStatus } from '../../contracts/graph/prepare/GraphPrepareStatus';
import { GraphPrepareJobStatus } from '../../contracts/graph/graphTypes';

// Default polling intervals and timeouts
export const DEFAULT_PREPARE_POLL_INTERVAL_MS = 1000;

export const DEFAULT_PREPARE_POLL_TIMEOUT_MS: number | null = null;

export async function prepareGraph(
    http: HttpClient,
    request: GraphPrepareRequest,
    options: GraphPrepareOptions = {}
): Promise<GraphPrepareResult> {
    const dto = toGraphPrepareRequestDto(request);
    const validRequest = isGraphPrepareRequestDto(dto);
    const submission = validRequest ? copyGraphPrepareRequestDto(dto) : dto;
    const pollingOptions = { ...options };
    await checkAPIService(http);
    if (!validRequest) {
        throw new Error(GRAPH_API_ERRORS.invalidPrepareRequest);
    }

    const response = await http.post<GraphPrepareRequestDto, GraphPrepareJobDto>(GRAPH_ROUTES.prepare, submission);

    if (!isGraphPrepareJobDto(response)) {
        throw new Error(GRAPH_API_ERRORS.invalidPrepareJob);
    }

    const job = toGraphPrepareJob(response);
    return pollPrepareGraph(http, job.jobId, pollingOptions);
}

async function pollPrepareGraph(
    http: HttpClient,
    jobId: string,
    options: GraphPrepareOptions
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
    const response = await http.get<GraphPrepareStatusDto>(GRAPH_ROUTES.prepareStatus(jobId));

    if (!isGraphPrepareStatusDto(response)) {
        throw new Error(GRAPH_API_ERRORS.invalidPrepareStatus);
    }

    return toGraphPrepareStatus(response);
}

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
