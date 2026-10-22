import type { GraphComponentsRequest, GraphComponentsResult } from '../../contracts/graph/components';
import type { HttpClient } from '../httpClient';
import { isRecord, isString, isFiniteNumber } from '../../validation/guards';

export async function readGraphComponents(
  http: HttpClient,
  request: GraphComponentsRequest
): Promise<GraphComponentsResult> {
  const response: unknown = await http.post('/api/graph/components', {
    dataset_id: request.datasetId,
    layout_version: request.layoutVersion,
    after: request.after,
    limit: request.limit,
  });
  if (
    !isRecord(response) ||
    response.dataset_id !== request.datasetId ||
    !isString(response.layout_version) ||
    (request.layoutVersion != null && response.layout_version !== request.layoutVersion) ||
    !Array.isArray(response.components) ||
    !(
      response.next_cursor === null ||
      (isFiniteNumber(response.next_cursor) &&
        Number.isSafeInteger(response.next_cursor) &&
        response.next_cursor >= 0 &&
        (request.after === undefined || response.next_cursor > request.after))
    )
  ) {
    throw new Error('Invalid forest component response.');
  }
  const components = response.components.map((value: unknown) => {
    if (
      !isRecord(value) ||
      !isString(value.component_id) ||
      !value.component_id ||
      !isFiniteNumber(value.node_count) ||
      !Number.isSafeInteger(value.node_count) ||
      value.node_count < 1 ||
      !isFiniteNumber(value.min_x) ||
      !isFiniteNumber(value.max_x) ||
      !isFiniteNumber(value.min_y) ||
      !isFiniteNumber(value.max_y) ||
      value.min_x > value.max_x ||
      value.min_y > value.max_y
    )
      throw new Error('Invalid forest component response.');
    return {
      id: value.component_id,
      nodeCount: value.node_count,
      bounds: { minX: value.min_x, maxX: value.max_x, minY: value.min_y, maxY: value.max_y },
    };
  });
  return { components, nextCursor: response.next_cursor };
}
