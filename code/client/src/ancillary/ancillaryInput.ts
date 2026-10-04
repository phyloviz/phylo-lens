import type { AncillaryData, AncillaryField, AncillaryTableInput } from "../contracts/ancillary";

export interface AncillaryInputOptions {
  ancillarySchema?: readonly AncillaryField[];
  ancillaryByNodeId?: Readonly<Record<string, AncillaryData>>;
  ancillaryData?: AncillaryTableInput;
}

export function resolveAncillaryInput(options: AncillaryInputOptions) {
  return {
    ancillarySchema: options.ancillarySchema ?? [],
    ancillaryByNodeId: options.ancillaryByNodeId ?? {},
  };
}
