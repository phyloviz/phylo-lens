declare const identifierKind: unique symbol;

export type NodeId = string & { readonly [identifierKind]: 'node' };
export type ClusterId = string & { readonly [identifierKind]: 'cluster' };
export type DatasetId = string & { readonly [identifierKind]: 'dataset' };
export type LayoutVersion = string & { readonly [identifierKind]: 'layout-version' };

// Brands distinguish identifier roles; the backend defines their string format.
export function toNodeId(value: string): NodeId {
  assertIdentifier(value);
  return value as NodeId;
}

export function toClusterId(value: string): ClusterId {
  assertIdentifier(value);
  return value as ClusterId;
}

export function toDatasetId(value: string): DatasetId {
  assertIdentifier(value);
  return value as DatasetId;
}

export function toLayoutVersion(value: string): LayoutVersion {
  assertIdentifier(value);
  return value as LayoutVersion;
}

function assertIdentifier(value: string): void {
  if (typeof value !== 'string') throw new TypeError('Graph identifiers must be strings.');
}
