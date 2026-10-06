import type { GraphAncillaryResponseDto } from './models/ancillary/GraphAncillaryResponseDto';
import type { HttpClient } from '../httpClient';
import type { GraphAncillaryRequest } from '../../contracts/graph/ancillary/GraphAncillaryRequest';
import type { GraphAncillaryResult } from '../../contracts/graph/ancillary/GraphAncillaryResult';
import type { GraphAncillaryRequestDto } from './models/ancillary/GraphAncillaryRequestDto';
import { GRAPH_ROUTES } from './graphRoutes';
import { toGraphAncillaryRequestDto, toGraphAncillaryResult } from './mappers/graphAncillaryMappers';
import { isGraphAncillaryResponseDto } from './guards/graphAncillaryGuards';
import { GRAPH_API_ERRORS } from './graphErrors';

export async function applyAncillaryData(
  http: HttpClient,
  request: GraphAncillaryRequest
): Promise<GraphAncillaryResult> {
  const datasetId = request.datasetId;
  const response = await http.put<GraphAncillaryRequestDto, GraphAncillaryResponseDto>(
    GRAPH_ROUTES.ancillary,
    toGraphAncillaryRequestDto(request)
  );
  if (!isGraphAncillaryResponseDto(response)) {
    throw new Error(GRAPH_API_ERRORS.invalidAncillaryResponse);
  }

  const result = toGraphAncillaryResult(response);
  if (result.datasetId !== datasetId) {
    throw new Error(GRAPH_API_ERRORS.invalidAncillaryResponse);
  }
  return result;
}
