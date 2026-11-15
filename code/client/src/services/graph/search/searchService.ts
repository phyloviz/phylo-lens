import type { GraphSearchResponseDto } from './searchDto';
import type { HttpClient } from '../../httpClient';
import type { GraphSearchRequest } from '../../../contracts/graph/search/GraphSearchRequest';
import type { GraphSearchResult } from '../../../contracts/graph/search/GraphSearchResult';
import type { GraphSearchRequestDto } from './searchDto';
import { GRAPH_ROUTES } from '../graphRoutes';
import { toGraphSearchRequestDto, toGraphSearchResult } from './searchMappers';
import { isGraphSearchResponseDto } from './searchGuards';
import { GRAPH_API_ERRORS } from '../graphErrors';

export async function searchGraph(http: HttpClient, request: GraphSearchRequest): Promise<GraphSearchResult> {
  const response = await http.post<GraphSearchRequestDto, GraphSearchResponseDto>(
    GRAPH_ROUTES.search,
    toGraphSearchRequestDto(request)
  );

  if (!isGraphSearchResponseDto(response)) {
    throw new Error(GRAPH_API_ERRORS.invalidSearchResponse);
  }

  return toGraphSearchResult(response);
}
