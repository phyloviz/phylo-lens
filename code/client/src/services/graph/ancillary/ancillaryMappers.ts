import { toDatasetId, toLayoutVersion } from '../../../contracts/graph/graphIdentifiers';
import type { AncillaryDataInput } from '../../../contracts/ancillary';
import type { AncillaryDataInputDto } from './ancillaryDto';
import type { GraphAncillaryRequest } from '../../../contracts/graph/ancillary/GraphAncillaryRequest';
import type { GraphAncillaryRequestDto } from './ancillaryDto';
import type { GraphAncillaryResponseDto } from './ancillaryDto';
import type { GraphAncillaryResult } from '../../../contracts/graph/ancillary/GraphAncillaryResult';

export function toAncillaryDataInputDto(input: AncillaryDataInput): AncillaryDataInputDto {
  return { content: input.content, join_column: input.joinColumn, format: input.format };
}

export function toGraphAncillaryRequestDto(request: GraphAncillaryRequest): GraphAncillaryRequestDto {
  return {
    dataset_id: request.datasetId,
    layout_version: request.layoutVersion,
    ancillary_data: toAncillaryDataInputDto(request.ancillaryData),
  };
}

export function toGraphAncillaryResult(dto: GraphAncillaryResponseDto): GraphAncillaryResult {
  return {
    datasetId: toDatasetId(dto.dataset_id),
    layoutVersion: toLayoutVersion(dto.layout_version),
    matchedNodeCount: dto.matched_node_count,
    warnings: [...dto.warnings],
  };
}
