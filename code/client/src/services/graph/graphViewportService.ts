import type { GraphViewportResponseDto } from './models/viewport/GraphViewportResponseDto';
import type { HttpClient } from '../httpClient';
import type { GraphViewportRequest } from '../../contracts/graph/viewport/GraphViewportRequest';
import type { GraphViewportResult } from '../../contracts/graph/viewport/GraphViewportResult';
import type { GraphViewportRequestDto } from './models/viewport/GraphViewportRequestDto';
import { GRAPH_ROUTES } from './graphRoutes';
import { toGraphViewportRequestDto, toGraphViewportResult } from './mappers/graphViewportMappers';
import { isGraphViewportResponseDto } from './guards/graphViewportGuards';
import { GRAPH_API_ERRORS } from './graphErrors';

export async function readGraphViewport(http: HttpClient, request: GraphViewportRequest): Promise<GraphViewportResult> {
  const response = await http.post<GraphViewportRequestDto, GraphViewportResponseDto>(
    GRAPH_ROUTES.viewport,
    toGraphViewportRequestDto(request)
  );

  if (!isGraphViewportResponseDto(response)) {
    throw new Error(GRAPH_API_ERRORS.invalidViewportResponse);
  }

  return toGraphViewportResult(response);
}
