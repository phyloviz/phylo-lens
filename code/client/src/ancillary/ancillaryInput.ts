import type { AncillaryData, AncillaryField, AncillaryTableInput } from '../contracts/ancillary';

export type AncillaryInputOptions = {
    readonly ancillarySchema?: readonly AncillaryField[];
    readonly ancillaryByNodeId?: Readonly<Record<string, AncillaryData>>;
    readonly ancillaryData?: AncillaryTableInput;
};

export function resolveAncillaryInput(options: AncillaryInputOptions) {
    return {
        ancillarySchema: options.ancillarySchema ?? [],
        ancillaryByNodeId: options.ancillaryByNodeId ?? {},
    };
}
