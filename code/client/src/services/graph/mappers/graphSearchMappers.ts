import { toClusterId, toDatasetId, toNodeId } from '../../../contracts/graph/graphIdentifiers';
import type { GraphSearchRequest } from '../../../contracts/graph/search/GraphSearchRequest';
import type { GraphSearchRequestDto } from '../models/search/GraphSearchRequestDto';
import type { GraphSearchResponseDto } from '../models/search/GraphSearchResponseDto';
import type { GraphSearchResult } from '../../../contracts/graph/search/GraphSearchResult';

export function toGraphSearchRequestDto(request: GraphSearchRequest): GraphSearchRequestDto {
  return {
    dataset_id: request.datasetId,
    layout_version: request.layoutVersion,
    query: request.query,
    limit: request.limit,
  };
}

export function toGraphSearchResult(dto: GraphSearchResponseDto): GraphSearchResult {
  return {
    datasetId: toDatasetId(dto.dataset_id),
    query: dto.query,
    totalCount: dto.total_count,
    matches: dto.matches.map(match => ({
      nodeId: toNodeId(match.node_id),
      score: match.score,
      matchedText: match.matched_text,
      clusterId: match.cluster_id == null ? match.cluster_id : toClusterId(match.cluster_id),
      x: match.x,
      y: match.y,
    })),
  };
}
