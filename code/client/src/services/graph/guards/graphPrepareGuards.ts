import type { GraphPrepareRequestDto } from '../models/prepare/GraphPrepareRequestDto';
import {
  isRecord,
  isOptionalString,
  isString,
  isFiniteNumber,
  isOptionalFiniteNumber,
  isArrayOf,
  isBoolean,
} from '../../../validation/guards';
import { isOptionalGraphMetadataSchema, isOptionalMetadataByNodeId, isGraphLayoutStatus } from './graphDataGuards';
import type { GraphPrepareResponseDto } from '../models/prepare/GraphPrepareResponseDto';
import type { GraphPrepareJobDto } from '../models/prepare/GraphPrepareJobDto';
import type { GraphPrepareStatusDto } from '../models/prepare/GraphPrepareStatusDto';
import type { GraphPrepareJobStatus } from '../../../contracts/graph/graphTypes';
import type { SfdpOptions } from '../../../contracts/graph/SfdpOptions';

export function isGraphPrepareRequestDto(value: unknown): value is GraphPrepareRequestDto {
  return (
    isRecord(value) &&
    isSourceFormat(value.format) &&
    isOptionalString(value.dataset_name) &&
    isString(value.content) &&
    isGraphPrepareOptions(value.options) &&
    isOptionalGraphMetadataSchema(value.metadata_schema) &&
    isOptionalMetadataByNodeId(value.metadata_by_node_id) &&
    isOptionalAncillaryDataRequest(value.ancillary_data) &&
    isOptionalSfdpOptions(value.sfdp_options)
  );
}

function isGraphPrepareResponseDto(value: unknown): value is GraphPrepareResponseDto {
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

function isGraphPrepareJobStatus(value: unknown): value is GraphPrepareJobStatus {
  return value === 'pending' || value === 'ready' || value === 'failed';
}

function isSourceFormat(value: unknown): boolean {
  return value === 'newick' || value === 'typing_data';
}

function isGraphPrepareOptions(value: unknown): boolean {
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
    'k',
    'repulsiveForce',
    'overlap',
    'prismIterations',
    'overlapScaling',
    'smoothing',
    'quadtree',
    'beautify',
  ]);
  if (Object.keys(value).some(key => !allowedKeys.has(key))) {
    return false;
  }
  const usesScaleOverlap = value.overlap === 'scale';
  return (
    (value.k === undefined || (isFiniteNumber(value.k) && value.k > 0)) &&
    (value.repulsiveForce === undefined || (isFiniteNumber(value.repulsiveForce) && value.repulsiveForce >= 0)) &&
    (value.overlap === undefined || value.overlap === 'prism' || value.overlap === 'scale') &&
    (value.prismIterations === undefined ||
      (isFiniteNumber(value.prismIterations) &&
        Number.isInteger(value.prismIterations) &&
        value.prismIterations >= 0)) &&
    (value.overlapScaling === undefined || isFiniteNumber(value.overlapScaling)) &&
    (value.smoothing === undefined ||
      value.smoothing === 'none' ||
      value.smoothing === 'avg_dist' ||
      value.smoothing === 'graph_dist' ||
      value.smoothing === 'power_dist' ||
      value.smoothing === 'rng' ||
      value.smoothing === 'spring' ||
      value.smoothing === 'triangle') &&
    (value.quadtree === undefined ||
      value.quadtree === 'none' ||
      value.quadtree === 'normal' ||
      value.quadtree === 'fast') &&
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
      (value.format === undefined || value.format === 'auto' || value.format === 'csv' || value.format === 'tsv'))
  );
}
