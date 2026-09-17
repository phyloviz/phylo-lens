import type { AncillaryObservation } from "../../contracts/ancillary";
import { decodeLegacyMetadata } from "../../ancillary/legacyMetadata";
import {
  PIE_DISTRIBUTION_ATTRIBUTE,
  MISSING_PIE_CATEGORY,
  type AncillaryData,
  type AncillaryRow,
  type PieCategory,
  type PieMappingOptions,
} from "./pieMapping.types";
import { categoryCountsForField, pieCategoricalAttributeKey } from "./pieCategoryCounts";

export * from "./pieMapping.types";
export * from "./pieCategoryCounts";
export * from "./pieColors";

/** Each observation contributes once, including missing values and numeric categories. */
export function pieDistribution(
  observations: readonly AncillaryObservation[],
  fields: readonly string[],
): PieCategory[] {
  const selected = [...new Set(fields.map((field) => field.trim()).filter(Boolean))].sort();
  if (!selected.length) return [];
  const counts = new Map<string, PieCategory>();
  for (const { values, count } of observations) {
    const categories = selected.map((field) => {
      const value = values[field];
      return value == null || String(value).trim() === "" ? null : String(value).trim();
    });
    const category =
      selected.length === 1
        ? (categories[0] ?? MISSING_PIE_CATEGORY)
        : JSON.stringify(selected.map((field, index) => [field, categories[index]]));
    const label =
      selected.length === 1
        ? categories[0] === "Missing"
          ? '"Missing"'
          : (categories[0] ?? "Missing")
        : selected
            .map(
              (field, index) =>
                `${field}: ${categories[index] === null ? "Missing" : JSON.stringify(categories[index])}`,
            )
            .join(" · ");
    const key = pieCategoricalAttributeKey(selected.length === 1 ? selected[0] : JSON.stringify(selected), category);
    const existing = counts.get(key);
    counts.set(key, {
      key,
      category,
      label,
      value: (existing?.value ?? 0) + count,
      missing: categories.every((value) => value === null),
    });
  }
  return [...counts.values()].sort((a, b) => b.value - a.value || a.key.localeCompare(b.key));
}

export function observationsFromAttributes(attributes?: Record<string, unknown>): AncillaryObservation[] {
  return (attributes?.ancillaryDistribution as AncillaryObservation[] | undefined) ?? [];
}

export function distributionFromAttributes(attributes?: Record<string, unknown>): PieCategory[] {
  return (attributes?.[PIE_DISTRIBUTION_ATTRIBUTE] as PieCategory[] | undefined) ?? [];
}

// Thin adapters for renderer consumers that build attributes directly.
export function buildPieAttributes(
  metadata: AncillaryData,
  options: PieMappingOptions,
  excludedFields: string[] = [],
  rows: AncillaryRow[] = [],
): Record<string, number> {
  return Object.fromEntries(
    mappingDistribution(metadata, options, excludedFields, rows).map((slice) => [slice.key, slice.value]),
  );
}

export function buildPieCategoryColorAttributes(
  metadata: AncillaryData,
  options: PieMappingOptions,
  excludedFields: string[] = [],
  rows: AncillaryRow[] = [],
): Record<string, string> {
  return Object.fromEntries(
    mappingDistribution(metadata, options, excludedFields, rows).flatMap((slice) => {
      const color = options.categoryColors?.[slice.category];
      return color && /^#[0-9a-fA-F]{6}$/.test(color) ? [[slice.key, color]] : [];
    }),
  );
}

function mappingDistribution(
  metadata: AncillaryData,
  options: PieMappingOptions,
  excluded: string[],
  rows: AncillaryRow[],
): PieCategory[] {
  if (options.enabled === false) return [];
  const fields = (options.fields ?? Object.keys(decodeLegacyMetadata(metadata).ancillaryData)).filter(
    (field) => !excluded.includes(field),
  );
  if (!rows.length && fields.length === 1) {
    const counts = categoryCountsForField(metadata, fields[0]);
    if (counts.length)
      return pieDistribution(
        counts.map((entry) => ({ values: { [entry.fieldKey]: entry.category }, count: entry.count })),
        fields,
      );
  }
  return pieDistribution(
    (rows.length ? rows : [metadata]).map((values) => ({ values, count: 1 })),
    fields,
  );
}
