import { isAncillaryData } from '../../../validation/ancillaryGuards';
import type { GraphViewportResponseDto } from './viewportDto';
import {
  isRecord,
  isString,
  isOptionalFiniteNumber,
  isFiniteNumber,
  isBoolean,
  isArrayOf,
  isOptionalBoolean,
  isOptionalString,
} from '../../../validation/guards';
import { isGraphLayoutStatus, isOptionalGraphMetadataSchema } from '../guards/graphDataGuards';
import type { GraphViewportNodeDto } from './viewportDto';
import type { AncillaryObservationDto } from './viewportDto';
import type { GraphIsolateDto } from './viewportDto';
import type { GraphViewportEdgeDto } from './viewportDto';

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
        (row): row is AncillaryObservationDto =>
          isRecord(row) &&
          isAncillaryData(row.values) &&
          isOptionalString(row.reference_id) &&
          isOptionalBoolean(row.values_cached) &&
          isFiniteNumber(row.count) &&
          Number.isSafeInteger(row.count) &&
          row.count > 0
      )) &&
    (value.isolates === undefined ||
      isArrayOf(
        value.isolates,
        (isolate): isolate is GraphIsolateDto =>
          isRecord(isolate) &&
          isString(isolate.id) &&
          isAncillaryData(isolate.metadata) &&
          isOptionalBoolean(isolate.metadata_cached)
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
