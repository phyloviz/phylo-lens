import type { DistanceConnectionsRequest, DistanceConnectionsResult } from '../../contracts/graph/connections';
import type { HttpClient } from '../httpClient';
import { isFiniteNumber, isRecord, isString } from '../../validation/guards';

export async function readDistanceConnections(
  http: HttpClient,
  request: DistanceConnectionsRequest,
  options?: { signal?: AbortSignal }
): Promise<DistanceConnectionsResult> {
  if (
    !Number.isFinite(request.threshold) ||
    request.threshold < 0 ||
    (request.format === 'typing_data' && !Number.isSafeInteger(request.threshold)) ||
    (request.maxConnections !== undefined &&
      (!Number.isSafeInteger(request.maxConnections) || request.maxConnections < 1))
  )
    throw new Error(
      'Use a nonnegative distance threshold and a positive whole-number connection limit. Allelic thresholds must be whole numbers.'
    );
  const metric = request.format === 'typing_data' ? 'allelic' : 'patristic';
  const result: unknown = await http.post(
    '/api/graph/connections',
    {
      dataset_id: request.datasetId,
      layout_version: request.layoutVersion,
      format: request.format,
      content: request.content,
      threshold: request.threshold,
      max_connections: request.maxConnections,
    },
    options
  );
  if (
    !isRecord(result) ||
    result.dataset_id !== request.datasetId ||
    result.layout_version !== request.layoutVersion ||
    result.metric !== metric ||
    result.threshold !== request.threshold ||
    !Array.isArray(result.edges)
  )
    throw new Error('Invalid distance-connection response.');
  const pairs = new Set<string>();
  const ids = new Set<string>();
  const edges = result.edges.map(edge => {
    if (
      !isRecord(edge) ||
      !isString(edge.id) ||
      !edge.id ||
      !isString(edge.source) ||
      !edge.source ||
      !isString(edge.target) ||
      !edge.target ||
      edge.source === edge.target ||
      !isFiniteNumber(edge.distance) ||
      edge.distance < 0 ||
      edge.distance > request.threshold
    )
      throw new Error('Invalid distance-connection edge.');
    const pair = JSON.stringify([edge.source, edge.target].sort());
    if (pairs.has(pair) || ids.has(edge.id)) throw new Error('Duplicate distance connection.');
    pairs.add(pair);
    ids.add(edge.id);
    return { id: edge.id, source: edge.source, target: edge.target, distance: edge.distance };
  });
  if (edges.length > (request.maxConnections ?? 50_000))
    throw new Error('Distance response exceeds its connection limit.');
  return { metric, threshold: request.threshold, edges };
}
