import type { PositionedGraph } from '../contracts/positioned';
import { readNodeAncillaryValues } from './ancillaryAccess';
import { observationsFromAttributes } from '../render/mapping/pieDistribution';
import { isCategoryCountMetadataKey } from '../render/mapping/pieCategoryCounts';

/** A column available for coloring, such as country with three distinct values. */
export type AncillaryFieldInfo = {
    name: string;
    distinctValueCount: number;
};

/** Find columns in the displayed observations. Empty cells do not add distinct values. */
export function getAncillaryFields(graph: PositionedGraph): AncillaryFieldInfo[] {
    const valuesByKey = new Map<string, Set<string>>();
    for (const node of graph.nodes) {
        const observations = observationsFromAttributes(node.attributes);
        const rows = observations.length
            ? observations.map(row => row.values)
            : [readNodeAncillaryValues(node.attributes)];
        for (const row of rows)
            for (const [field, value] of Object.entries(row)) {
                if (field === 'profile_count' || isCategoryCountMetadataKey(field)) continue;
                const values = valuesByKey.get(field) ?? new Set<string>();
                if (value != null && String(value).trim()) values.add(String(value));
                valuesByKey.set(field, values);
            }
    }
    return [...valuesByKey]
        .map(([key, values]) => ({ name: key, distinctValueCount: values.size }))
        .sort((a, b) => a.name.localeCompare(b.name));
}
