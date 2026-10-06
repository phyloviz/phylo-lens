import type { GraphSearchResponseDto } from '../models/search/GraphSearchResponseDto';
import { isRecord, isString, isFiniteNumber, isArrayOf, isOptionalFiniteNumber } from '../../../validation/guards';
import type { GraphSearchMatchDto } from '../models/search/GraphSearchMatchDto';

export function isGraphSearchResponseDto(value: unknown): value is GraphSearchResponseDto {
  return (
    isRecord(value) &&
    isString(value.dataset_id) &&
    isString(value.query) &&
    isFiniteNumber(value.total_count) &&
    isArrayOf(value.matches, isGraphSearchMatchDto)
  );
}

function isGraphSearchMatchDto(value: unknown): value is GraphSearchMatchDto {
  return (
    isRecord(value) &&
    isString(value.node_id) &&
    isFiniteNumber(value.score) &&
    isString(value.matched_text) &&
    (value.cluster_id == null || isString(value.cluster_id)) &&
    isOptionalFiniteNumber(value.x) &&
    isOptionalFiniteNumber(value.y)
  );
}
