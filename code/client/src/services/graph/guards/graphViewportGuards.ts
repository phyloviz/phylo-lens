import type { GraphViewportResponseDto } from "../models/viewport/GraphViewportResponseDto";
import {
  isRecord,
  isString,
  isOptionalFiniteNumber,
  isFiniteNumber,
  isBoolean,
  isArrayOf,
  isOptionalBoolean,
} from "../../../validation/guards";
import { isGraphLayoutStatus, isOptionalGraphMetadataSchema, isGraphMetadata } from "./graphDataGuards";
import type { GraphViewportNodeDto } from "../models/viewport/GraphViewportNodeDto";
import type { AncillaryObservation } from "../../../contracts/ancillary";
import type { GraphIsolateDto } from "../models/viewport/GraphIsolateDto";
import type { GraphViewportEdgeDto } from "../models/viewport/GraphViewportEdgeDto";

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
    (value.metadata == null || isGraphMetadata(value.metadata)) &&
    (value.ancillary_distribution === undefined ||
      isArrayOf(
        value.ancillary_distribution,
        (row): row is AncillaryObservation =>
          isRecord(row) &&
          isGraphMetadata(row.values) &&
          isFiniteNumber(row.count) &&
          Number.isSafeInteger(row.count) &&
          row.count > 0,
      )) &&
    (value.isolates === undefined ||
      isArrayOf(
        value.isolates,
        (isolate): isolate is GraphIsolateDto =>
          isRecord(isolate) && isString(isolate.id) && isGraphMetadata(isolate.metadata),
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
