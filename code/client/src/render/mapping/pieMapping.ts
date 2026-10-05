import { pieDistribution } from './pieDistribution';
export * from './pieDistribution';
import { decodeApiMetadata } from '../../ancillary/apiMetadata';
import { type AncillaryData, type AncillaryRow, type PieCategory, type PieMappingOptions } from './pieMapping.types';
import { categoryCountsForField } from './pieCategoryCounts';

export * from './pieMapping.types';
export * from './pieCategoryCounts';
export * from './pieColors';

// Thin adapters for renderer consumers that build attributes directly.
export function buildPieAttributes(
    metadata: AncillaryData,
    options: PieMappingOptions,
    excludedFields: readonly string[] = [],
    rows: readonly AncillaryRow[] = []
): Record<string, number> {
    return Object.fromEntries(
        mappingDistribution(metadata, options, excludedFields, rows).map(slice => [slice.key, slice.value])
    );
}

export function buildPieCategoryColorAttributes(
    metadata: AncillaryData,
    options: PieMappingOptions,
    excludedFields: readonly string[] = [],
    rows: readonly AncillaryRow[] = []
): Record<string, string> {
    return Object.fromEntries(
        mappingDistribution(metadata, options, excludedFields, rows).flatMap(slice => {
            const color = options.categoryColors?.[slice.category];
            return color && /^#[0-9a-fA-F]{6}$/.test(color) ? [[slice.key, color]] : [];
        })
    );
}

function mappingDistribution(
    metadata: AncillaryData,
    options: PieMappingOptions,
    excluded: readonly string[],
    rows: readonly AncillaryRow[]
): readonly PieCategory[] {
    if (options.enabled === false) return [];
    const fields = (options.fields ?? Object.keys(decodeApiMetadata(metadata).ancillaryData)).filter(
        field => !excluded.includes(field)
    );
    if (!rows.length && fields.length === 1) {
        const counts = categoryCountsForField(metadata, fields[0]);
        if (counts.length)
            return pieDistribution(
                counts.map(entry => ({ values: { [entry.fieldKey]: entry.category }, count: entry.count })),
                fields
            );
    }
    return pieDistribution(
        (rows.length ? rows : [metadata]).map(values => ({ values, count: 1 })),
        fields
    );
}
