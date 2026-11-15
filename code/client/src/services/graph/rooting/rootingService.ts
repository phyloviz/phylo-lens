import type { GraphRootingRequest, GraphRootingResult } from '../../../contracts/graph/rooting';
import type { HttpClient } from '../../httpClient';
import { isRecord, isString, isArrayOf } from '../../../validation/guards';
import { isGraphPrepareResponseDto } from '../prepare/prepareGuards';
import { toGraphPrepareResult } from '../prepare/prepareMappers';

export async function setTechnicalRoot(http: HttpClient, request: GraphRootingRequest): Promise<GraphRootingResult> {
  const response: unknown = await http.post('/api/graph/root', {
    dataset_id: request.datasetId,
    layout_version: request.layoutVersion,
    node_id: request.nodeId,
  });
  if (
    !isGraphPrepareResponseDto(response) ||
    !isRecord(response) ||
    !isArrayOf(response.technical_roots, isString) ||
    !response.technical_roots.length ||
    !isArrayOf(response.default_roots, isString) ||
    !response.default_roots.length ||
    !isRecord(response.component_ids) ||
    !Object.values(response.component_ids).every(isString) ||
    response.dataset_id !== request.datasetId ||
    !response.layout_version ||
    (request.nodeId !== null && !response.technical_roots.includes(request.nodeId))
  ) {
    throw new Error('The graph service returned an invalid technical-root revision.');
  }
  const componentIds: Record<string, string> = {};
  const technicalRoots = response.technical_roots;
  if (
    (response.layout_status !== 'ready' && response.layout_status !== 'degraded') ||
    new Set(technicalRoots).size !== technicalRoots.length ||
    new Set(response.default_roots).size !== technicalRoots.length ||
    response.default_roots.length !== technicalRoots.length ||
    Object.keys(response.component_ids).length !== technicalRoots.length ||
    new Set(Object.values(response.component_ids)).size !== technicalRoots.length ||
    !Number.isSafeInteger(response.lod_tier_count) ||
    (response.lod_tier_count ?? 0) < 1
  ) {
    throw new Error('The graph service returned an incomplete rooted forest.');
  }
  for (const [key, value] of Object.entries(response.component_ids)) {
    if (!isString(value) || !technicalRoots.includes(value)) {
      throw new Error('The graph service returned an invalid component mapping.');
    }
    Object.defineProperty(componentIds, key, { value, enumerable: true });
  }
  if (
    request.nodeId === null &&
    (technicalRoots.length !== response.default_roots.length ||
      response.default_roots.some(root => !technicalRoots.includes(root)))
  ) {
    throw new Error('The graph service did not restore the default roots.');
  }
  return {
    ...toGraphPrepareResult(response),
    technicalRoots: [...response.technical_roots],
    defaultRoots: [...response.default_roots],
    componentIds,
  };
}
