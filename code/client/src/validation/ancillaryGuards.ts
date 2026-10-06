import type { AncillaryData, AncillaryField, AncillaryValue } from '../contracts/ancillary';
import { isArrayOf, isBoolean, isFiniteNumber, isRecord, isString } from './guards';

export function isAncillaryValue(value: unknown): value is AncillaryValue {
  return value === null || isString(value) || isBoolean(value) || isFiniteNumber(value);
}

export function isAncillaryData(value: unknown): value is AncillaryData {
  return isRecord(value) && Object.values(value).every(isAncillaryValue);
}

export function isAncillaryByNodeId(value: unknown): value is Record<string, AncillaryData> {
  return isRecord(value) && Object.values(value).every(isAncillaryData);
}

export function isAncillaryField(value: unknown): value is AncillaryField {
  return (
    isRecord(value) &&
    isString(value.key) &&
    isString(value.type) &&
    ['string', 'number', 'boolean', 'null'].includes(value.type)
  );
}

export function isAncillarySchema(value: unknown): value is AncillaryField[] {
  return isArrayOf(value, isAncillaryField);
}
