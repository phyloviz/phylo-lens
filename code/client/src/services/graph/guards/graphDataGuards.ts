import type { GraphLayoutStatus } from "../../../contracts/graph/graphTypes";
import type { AncillaryData, AncillaryValue, AncillaryField } from "../../../contracts/ancillary";
import { isRecord, isString, isBoolean, isFiniteNumber, isArrayOf } from "../../../validation/guards";

export function isGraphLayoutStatus(value: unknown): value is GraphLayoutStatus {
  return value === "pending" || value === "refining" || value === "ready" || value === "degraded" || value === "failed";
}

export function isGraphMetadata(value: unknown): value is AncillaryData {
  return isRecord(value) && Object.values(value).every(isGraphMetadataValue);
}

export function isOptionalMetadataByNodeId(value: unknown): boolean {
  return value === undefined || (isRecord(value) && Object.values(value).every(isGraphMetadata));
}

function isGraphMetadataValue(value: unknown): value is AncillaryValue {
  return value === null || isString(value) || isBoolean(value) || isFiniteNumber(value);
}

export function isOptionalGraphMetadataSchema(value: unknown): value is AncillaryField[] | undefined {
  return value === undefined || isArrayOf(value, isGraphMetadataField);
}

function isGraphMetadataField(value: unknown): value is AncillaryField {
  return isRecord(value) && isString(value.key) && isString(value.type);
}
