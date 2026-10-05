import type { AncillaryObservation } from "../contracts/ancillary";
import {
  isArrayOf,
  isBoolean,
  isFiniteNumber,
  isOptionalBoolean,
  isOptionalFiniteNumber,
  isOptionalString,
  isRecord,
  isString,
} from "../validation/guards";
import type { AncillaryData, AncillaryField, AncillaryValue } from "../contracts/ancillary";
import type { GraphLayoutStatus, GraphPrepareJobStatus, SfdpOptions } from "../contracts/graph";
import type {
  GraphAncillaryResponseDto,
  GraphIsolateDto,
  GraphPrepareJobDto,
  GraphPrepareResponseDto,
  GraphPrepareStatusDto,
  GraphRegionResponseDto,
  GraphSearchMatchDto,
  GraphSearchResponseDto,
  GraphViewportEdgeDto,
  GraphViewportNodeDto,
  GraphViewportResponseDto,
  GraphPrepareRequestDto,
  ServiceInformationDto,
} from "./dto/graph.dto";

export function isGraphPrepareRequestDto(value: unknown): value is GraphPrepareRequestDto {
  return (
    isRecord(value) &&
    isSourceFormat(value.format) &&
    isOptionalString(value.dataset_name) &&
    isString(value.content) &&
    isOptionalNormalizeOptions(value.options) &&
    isOptionalGraphMetadataSchema(value.metadata_schema) &&
    isOptionalMetadataByNodeId(value.metadata_by_node_id) &&
    isOptionalAncillaryDataRequest(value.ancillary_data) &&
    isOptionalSfdpOptions(value.sfdp_options)
  );
}

export function isGraphPrepareResponseDto(value: unknown): value is GraphPrepareResponseDto {
  return (
    isRecord(value) &&
    isString(value.dataset_id) &&
    isString(value.layout_version) &&
    isFiniteNumber(value.node_count) &&
    isFiniteNumber(value.edge_count) &&
    isFiniteNumber(value.cluster_count) &&
    isOptionalFiniteNumber(value.lod_tier_count) &&
    isGraphLayoutStatus(value.layout_status) &&
    isArrayOf(value.warnings, isString)
  );
}

export function isGraphPrepareJobDto(value: unknown): value is GraphPrepareJobDto {
  return (
    isRecord(value) && isString(value.job_id) && isGraphPrepareJobStatus(value.status) && isString(value.dataset_id)
  );
}

export function isGraphPrepareStatusDto(value: unknown): value is GraphPrepareStatusDto {
  return (
    isRecord(value) &&
    isString(value.job_id) &&
    isGraphPrepareJobStatus(value.status) &&
    (value.result == null || isGraphPrepareResponseDto(value.result)) &&
    isOptionalString(value.error) &&
    (value.error_details == null || isGraphPrepareErrorDetailsDto(value.error_details))
  );
}

function isGraphPrepareErrorDetailsDto(value: unknown): boolean {
  return (
    isRecord(value) &&
    isString(value.algorithm) &&
    isString(value.stage) &&
    isOptionalFiniteNumber(value.exit_status) &&
    isOptionalFiniteNumber(value.timeout_seconds) &&
    isOptionalString(value.stderr) &&
    isOptionalString(value.detail)
  );
}

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

export function isGraphRegionResponseDto(value: unknown): value is GraphRegionResponseDto {
  return (
    isRecord(value) &&
    isString(value.dataset_id) &&
    isString(value.layout_version) &&
    isGraphLayoutStatus(value.layout_status) &&
    isBoolean(value.truncated) &&
    isFiniteNumber(value.total_node_count) &&
    isArrayOf(value.nodes, isGraphViewportNodeDto) &&
    isArrayOf(value.edges, isGraphViewportEdgeDto) &&
    isOptionalGraphMetadataSchema(value.metadata_schema) &&
    isGraphMetadata(value.aggregated_metadata)
  );
}

export function isGraphSearchResponseDto(value: unknown): value is GraphSearchResponseDto {
  return (
    isRecord(value) &&
    isString(value.dataset_id) &&
    isString(value.query) &&
    isFiniteNumber(value.total_count) &&
    isArrayOf(value.matches, isGraphSearchMatchDto)
  );
}

function isGraphPrepareJobStatus(value: unknown): value is GraphPrepareJobStatus {
  return value === "pending" || value === "ready" || value === "failed";
}

function isSourceFormat(value: unknown): boolean {
  return value === "newick" || value === "typing_data";
}

function isGraphLayoutStatus(value: unknown): value is GraphLayoutStatus {
  return value === "pending" || value === "refining" || value === "ready" || value === "degraded" || value === "failed";
}

function isGraphViewportNodeDto(value: unknown): value is GraphViewportNodeDto {
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

function isGraphViewportEdgeDto(value: unknown): value is GraphViewportEdgeDto {
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

function isGraphMetadata(value: unknown): value is AncillaryData {
  return isRecord(value) && Object.values(value).every(isGraphMetadataValue);
}

function isOptionalMetadataByNodeId(value: unknown): boolean {
  return value === undefined || (isRecord(value) && Object.values(value).every(isGraphMetadata));
}

function isGraphMetadataValue(value: unknown): value is AncillaryValue {
  return value === null || isString(value) || isBoolean(value) || isFiniteNumber(value);
}

function isOptionalNormalizeOptions(value: unknown): boolean {
  return (
    value === undefined ||
    (isRecord(value) && (value.allow_self_loops === undefined || isBoolean(value.allow_self_loops)))
  );
}

function isOptionalSfdpOptions(value: unknown): value is SfdpOptions | undefined {
  if (value === undefined) {
    return true;
  }
  if (!isRecord(value)) {
    return false;
  }
  const allowedKeys = new Set([
    "k",
    "repulsiveForce",
    "overlap",
    "prismIterations",
    "overlapScaling",
    "smoothing",
    "quadtree",
    "beautify",
  ]);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    return false;
  }
  const usesScaleOverlap = value.overlap === "scale";
  return (
    (value.k === undefined || (isFiniteNumber(value.k) && value.k > 0)) &&
    (value.repulsiveForce === undefined || (isFiniteNumber(value.repulsiveForce) && value.repulsiveForce >= 0)) &&
    (value.overlap === undefined || value.overlap === "prism" || value.overlap === "scale") &&
    (value.prismIterations === undefined ||
      (isFiniteNumber(value.prismIterations) &&
        Number.isInteger(value.prismIterations) &&
        value.prismIterations >= 0)) &&
    (value.overlapScaling === undefined || isFiniteNumber(value.overlapScaling)) &&
    (value.smoothing === undefined ||
      value.smoothing === "none" ||
      value.smoothing === "avg_dist" ||
      value.smoothing === "graph_dist" ||
      value.smoothing === "power_dist" ||
      value.smoothing === "rng" ||
      value.smoothing === "spring" ||
      value.smoothing === "triangle") &&
    (value.quadtree === undefined ||
      value.quadtree === "none" ||
      value.quadtree === "normal" ||
      value.quadtree === "fast") &&
    (value.beautify === undefined || isBoolean(value.beautify)) &&
    (!usesScaleOverlap || (value.prismIterations === undefined && value.overlapScaling === undefined))
  );
}

function isOptionalAncillaryDataRequest(value: unknown): boolean {
  return (
    value === undefined ||
    (isRecord(value) &&
      isString(value.content) &&
      isString(value.join_column) &&
      (value.format === undefined || value.format === "auto" || value.format === "csv" || value.format === "tsv"))
  );
}

function isOptionalGraphMetadataSchema(value: unknown): value is AncillaryField[] | undefined {
  return value === undefined || isArrayOf(value, isGraphMetadataField);
}

function isGraphMetadataField(value: unknown): value is AncillaryField {
  return isRecord(value) && isString(value.key) && isString(value.type);
}

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

export function isServiceInformationDto(value: unknown): value is ServiceInformationDto {
  return (
    isRecord(value) &&
    value.status === "ok" &&
    typeof value.service_version === "string" &&
    typeof value.api_version === "string"
  );
}
