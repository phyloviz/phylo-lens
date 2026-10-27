import { isAncillaryData } from '../../../validation/ancillaryGuards';
import type { GraphViewportResponseDto } from '../models/viewport/GraphViewportResponseDto';
import {
  isRecord,
  isString,
  isOptionalFiniteNumber,
  isFiniteNumber,
  isBoolean,
  isArrayOf,
  isOptionalBoolean,
} from '../../../validation/guards';
import { isGraphLayoutStatus, isOptionalGraphMetadataSchema } from './graphDataGuards';
import type { GraphViewportNodeDto } from '../models/viewport/GraphViewportNodeDto';
import type { AncillaryObservation } from '../../../contracts/ancillary';
import type { GraphIsolateDto } from '../models/viewport/GraphIsolateDto';
import type { GraphViewportEdgeDto } from '../models/viewport/GraphViewportEdgeDto';

export function isGraphViewportResponseDto(value: unknown): value is GraphViewportResponseDto {
  return (
    isRecord(value) &&
    isString(value.dataset_id) &&
    isString(value.layout_version) &&
    isOptionalFiniteNumber(value.lod_level) &&
    isFiniteNumber(value.zoom) &&
    isGraphLayoutStatus(value.layout_status) &&
    isBoolean(value.truncated) &&
    isFiniteNumber(value.total_node_count) &&
    isArrayOf(value.nodes, isGraphViewportNodeDto) &&
    isArrayOf(value.edges, isGraphViewportEdgeDto) &&
    (value.global_bounds == null || isGraphLayoutBoundsDto(value.global_bounds)) &&
    isOptionalGraphMetadataSchema(value.metadata_schema)
  );
}

export function isGraphViewportNodeDto(value: unknown): value is GraphViewportNodeDto {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.cluster_id) &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    isGraphLayoutStatus(value.layout_status) &&
    isFiniteNumber(value.member_count) &&
    isBoolean(value.is_representative) &&
    isOptionalBoolean(value.annotations_cached) &&
    (value.tree_index == null || isTreeIndexDto(value.tree_index)) &&
    (value.metadata == null || isAncillaryData(value.metadata)) &&
    (value.ancillary_distribution === undefined ||
      isArrayOf(
        value.ancillary_distribution,
        (row): row is AncillaryObservation =>
          isRecord(row) &&
          isAncillaryData(row.values) &&
          isFiniteNumber(row.count) &&
          Number.isSafeInteger(row.count) &&
          row.count > 0
      )) &&
    (value.isolates === undefined ||
      isArrayOf(
        value.isolates,
        (isolate): isolate is GraphIsolateDto =>
          isRecord(isolate) && isString(isolate.id) && isAncillaryData(isolate.metadata)
      ))
  );
}

export function isGraphViewportEdgeDto(value: unknown): value is GraphViewportEdgeDto {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.source) &&
    isString(value.target) &&
    isOptionalFiniteNumber(value.distance) &&
    isOptionalBoolean(value.is_meta)
  );
}

function isGraphLayoutBoundsDto(value: unknown): boolean {
  return (
    isRecord(value) &&
    isFiniteNumber(value.min_x) &&
    isFiniteNumber(value.max_x) &&
    isFiniteNumber(value.min_y) &&
    isFiniteNumber(value.max_y)
  );
}

function isTreeIndexDto(value: unknown): boolean {
  return (
    isRecord(value) &&
    isString(value.component_id) &&
    (value.parent_id == null || isString(value.parent_id)) &&
    isFiniteNumber(value.depth) &&
    Number.isSafeInteger(value.depth) &&
    value.depth >= 0 &&
    isFiniteNumber(value.start) &&
    Number.isSafeInteger(value.start) &&
    value.start >= 0 &&
    isFiniteNumber(value.end) &&
    Number.isSafeInteger(value.end) &&
    value.end > value.start
  );
}
