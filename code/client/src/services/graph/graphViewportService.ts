import type { GraphViewportResponseDto } from './models/viewport/GraphViewportResponseDto';
import type { HttpClient } from '../httpClient';
import type { GraphViewportRequest } from '../../contracts/graph/viewport/GraphViewportRequest';
import type { GraphViewportResult } from '../../contracts/graph/viewport/GraphViewportResult';
import type { GraphViewportRequestDto } from './models/viewport/GraphViewportRequestDto';
import { GRAPH_ROUTES } from './graphRoutes';
import { toGraphViewportRequestDto, toGraphViewportResult } from './mappers/graphViewportMappers';
import { isGraphViewportResponseDto } from './guards/graphViewportGuards';
import { GRAPH_API_ERRORS } from './graphErrors';
import type { GraphViewportReadOptions } from '../../contracts/graph/viewport/GraphViewportReadOptions';
import { reusableAnnotations, reusableObservations, restoreViewportAnnotations } from './viewportAnnotations';

export async function readGraphViewport(
  http: HttpClient,
  request: GraphViewportRequest,
  options: GraphViewportReadOptions = {}
): Promise<GraphViewportResult> {
  const known = reusableAnnotations(request, options.annotationsFrom);
  const observations = reusableObservations(known);
  const dto = toGraphViewportRequestDto(request);
  if (request.layoutVersion) dto.known_observations = [...observations.keys()];
  if (known.size) {
    dto.known_annotations = [...known.values()].map(node => ({
      node_id: node.id,
      cluster_id: node.clusterId,
      is_representative: node.isRepresentative,
    }));
  }
  const response = await http.post<GraphViewportRequestDto, GraphViewportResponseDto>(GRAPH_ROUTES.viewport, dto, {
    signal: options.signal,
  });

  if (!isGraphViewportResponseDto(response)) {
    throw new Error(GRAPH_API_ERRORS.invalidViewportResponse);
  }

  return restoreViewportAnnotations(toGraphViewportResult(response), response, known, request, observations);
}
