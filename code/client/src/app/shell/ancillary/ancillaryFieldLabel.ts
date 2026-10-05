import type { AncillaryFieldInfo } from '../../../ancillary/ancillaryFields';

const HIGH_CARDINALITY_PIE_FIELD_THRESHOLD = 24;

/** Keep the field picker readable when a column contains many different values. */
export function formatAncillaryFieldLabel(field: AncillaryFieldInfo): string {
    const suffix =
        field.distinctValueCount > HIGH_CARDINALITY_PIE_FIELD_THRESHOLD
            ? 'many values'
            : `${field.distinctValueCount} values`;
    return `${field.name} (${suffix})`;
}
