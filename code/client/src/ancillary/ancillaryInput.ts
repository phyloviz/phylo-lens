import type { AncillaryData, AncillaryField, AncillaryTableInput } from "../contracts/ancillary";

export interface AncillaryInputOptions {
  ancillarySchema?: AncillaryField[];
  ancillaryByNodeId?: Record<string, AncillaryData>;
  ancillaryData?: AncillaryTableInput;
  /** @deprecated Use ancillarySchema. */
  metadataSchema?: AncillaryField[];
  /** @deprecated Use ancillaryByNodeId. */
  metadataByNodeId?: Record<string, AncillaryData>;
}

export function resolveAncillaryInput(options: AncillaryInputOptions) {
  return {
    ancillarySchema:
      resolveAlias(options.ancillarySchema, options.metadataSchema, "ancillarySchema", "metadataSchema") ?? [],
    ancillaryByNodeId:
      resolveAlias(options.ancillaryByNodeId, options.metadataByNodeId, "ancillaryByNodeId", "metadataByNodeId") ?? {},
  };
}

function resolveAlias<T>(value: T | undefined, legacy: T | undefined, name: string, legacyName: string): T | undefined {
  if (value !== undefined && legacy !== undefined)
    throw new Error(`Supply ${name} or deprecated ${legacyName}, not both.`);
  return value ?? legacy;
}
