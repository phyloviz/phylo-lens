import type { GraphAncillaryResponseDto } from "../models/ancillary/GraphAncillaryResponseDto";
import { isRecord, isString, isFiniteNumber, isArrayOf } from "../../../validation/guards";

export function isGraphAncillaryResponseDto(value: unknown): value is GraphAncillaryResponseDto {
  return (
    isRecord(value) &&
    isString(value.dataset_id) &&
    value.dataset_id.length > 0 &&
    isString(value.layout_version) &&
    value.layout_version.length > 0 &&
    isFiniteNumber(value.matched_node_count) &&
    Number.isInteger(value.matched_node_count) &&
    value.matched_node_count > 0 &&
    isArrayOf(value.warnings, isString)
  );
}
