import type { GraphLayoutStatus } from '../../../contracts/graph/graphTypes';
import type { AncillaryField } from '../../../contracts/ancillary';
import { isAncillaryByNodeId, isAncillarySchema } from '../../../validation/ancillaryGuards';

export function isGraphLayoutStatus(value: unknown): value is GraphLayoutStatus {
  return value === 'pending' || value === 'refining' || value === 'ready' || value === 'degraded' || value === 'failed';
}

export function isOptionalMetadataByNodeId(value: unknown): boolean {
  return value === undefined || isAncillaryByNodeId(value);
}

export function isOptionalGraphMetadataSchema(value: unknown): value is AncillaryField[] | undefined {
  return value === undefined || isAncillarySchema(value);
}
