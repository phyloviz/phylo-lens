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
import type {
  GraphLayoutStatus,
  GraphMetadata,
  GraphMetadataField,
  GraphMetadataValue,
  GraphPrepareJob,
  GraphPrepareJobStatus,
  GraphPrepareResponse,
  GraphPrepareStatus,
  GraphRegionResponse,
  GraphSearchMatch,
  GraphSearchResponse,
  GraphViewportEdge,
  GraphViewportNode,
  GraphViewportResponse,
  NormalizeRequest,
} from "./graphContracts";

export function isNormalizeRequest(value: unknown): value is NormalizeRequest {
  return (
    isRecord(value) &&
    isSourceFormat(value.format) &&
    isString(value.dataset_name) &&
    isString(value.content) &&
    isOptionalNormalizeOptions(value.options) &&
    isOptionalGraphMetadataSchema(value.metadata_schema) &&
    isOptionalMetadataByNodeId(value.metadata_by_node_id) &&
    isOptionalAncillaryDataRequest(value.ancillary_data)
  );
}

export function isGraphPrepareResponse(value: unknown): value is GraphPrepareResponse {
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

export function isGraphPrepareJob(value: unknown): value is GraphPrepareJob {
  return (
    isRecord(value) && isString(value.job_id) && isGraphPrepareJobStatus(value.status) && isString(value.dataset_id)
  );
}

export function isGraphPrepareStatus(value: unknown): value is GraphPrepareStatus {
  return (
    isRecord(value) &&
    isString(value.job_id) &&
    isGraphPrepareJobStatus(value.status) &&
    (value.result == null || isGraphPrepareResponse(value.result)) &&
    isOptionalString(value.error)
  );
}

export function isGraphViewportResponse(value: unknown): value is GraphViewportResponse {
  return (
    isRecord(value) &&
    isString(value.dataset_id) &&
    isString(value.layout_version) &&
    isOptionalFiniteNumber(value.lod_level) &&
    isFiniteNumber(value.zoom) &&
    isGraphLayoutStatus(value.layout_status) &&
    isBoolean(value.truncated) &&
    isFiniteNumber(value.total_node_count) &&
    isArrayOf(value.nodes, isGraphViewportNode) &&
    isArrayOf(value.edges, isGraphViewportEdge) &&
    (value.global_bounds == null || isGraphLayoutBounds(value.global_bounds)) &&
    isOptionalGraphMetadataSchema(value.metadata_schema)
  );
}

export function isGraphRegionResponse(value: unknown): value is GraphRegionResponse {
  return (
    isRecord(value) &&
    isString(value.dataset_id) &&
    isString(value.layout_version) &&
    isGraphLayoutStatus(value.layout_status) &&
    isBoolean(value.truncated) &&
    isFiniteNumber(value.total_node_count) &&
    isArrayOf(value.nodes, isGraphViewportNode) &&
    isArrayOf(value.edges, isGraphViewportEdge) &&
    isOptionalGraphMetadataSchema(value.metadata_schema) &&
    isGraphMetadata(value.aggregated_metadata)
  );
}

export function isGraphSearchResponse(value: unknown): value is GraphSearchResponse {
  return (
    isRecord(value) &&
    isString(value.dataset_id) &&
    isString(value.query) &&
    isFiniteNumber(value.total_count) &&
    isArrayOf(value.matches, isGraphSearchMatch)
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

function isGraphViewportNode(value: unknown): value is GraphViewportNode {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.cluster_id) &&
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    isGraphLayoutStatus(value.layout_status) &&
    isFiniteNumber(value.member_count) &&
    isBoolean(value.is_representative) &&
    (value.metadata == null || isGraphMetadata(value.metadata))
  );
}

function isGraphViewportEdge(value: unknown): value is GraphViewportEdge {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.source) &&
    isString(value.target) &&
    isOptionalFiniteNumber(value.distance) &&
    isOptionalBoolean(value.is_meta) &&
    isOptionalFiniteNumber(value.bundled_edge_count)
  );
}

function isGraphLayoutBounds(value: unknown): boolean {
  return (
    isRecord(value) &&
    isFiniteNumber(value.min_x) &&
    isFiniteNumber(value.max_x) &&
    isFiniteNumber(value.min_y) &&
    isFiniteNumber(value.max_y)
  );
}

function isGraphSearchMatch(value: unknown): value is GraphSearchMatch {
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

function isGraphMetadata(value: unknown): value is GraphMetadata {
  return isRecord(value) && Object.values(value).every(isGraphMetadataValue);
}

function isOptionalMetadataByNodeId(value: unknown): boolean {
  return value === undefined || (isRecord(value) && Object.values(value).every(isGraphMetadata));
}

function isGraphMetadataValue(value: unknown): value is GraphMetadataValue {
  return value === null || isString(value) || isBoolean(value) || isFiniteNumber(value);
}

function isOptionalNormalizeOptions(value: unknown): boolean {
  return (
    value === undefined ||
    (isRecord(value) && (value.allow_self_loops === undefined || isBoolean(value.allow_self_loops)))
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

function isOptionalGraphMetadataSchema(value: unknown): value is GraphMetadataField[] | undefined {
  return value === undefined || isArrayOf(value, isGraphMetadataField);
}

function isGraphMetadataField(value: unknown): value is GraphMetadataField {
  return isRecord(value) && isString(value.key) && isString(value.type);
}
