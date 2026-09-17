import type { AncillaryObservation, AncillaryData } from "../../contracts/ancillary";
import { readNodeAnnotations, readNodeAncillaryValues } from "../../ancillary/ancillaryAccess";
import {
  PIE_DISTRIBUTION_ATTRIBUTE,
  MISSING_PIE_CATEGORY,
  type PieCategory,
  type PieCategoryGrouping,
} from "./pieMapping.types";
import { categoryCountsForField, pieCategoricalAttributeKey } from "./pieCategoryCounts";

/** Each observation contributes once, including missing values and numeric categories. */
export function pieDistribution(
  observations: readonly AncillaryObservation[],
  fields: readonly string[],
): PieCategory[] {
  const selected = normalizedPieFields(fields);
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
        ? ["Missing", "Other", "Others", "Other (grouped)"].includes(categories[0] ?? "")
          ? JSON.stringify(categories[0])
          : (categories[0] ?? "Missing")
        : selected
            .map(
              (field, index) =>
                `${field}: ${categories[index] === null ? "Missing" : JSON.stringify(categories[index])}`,
            )
            .join(" · ");
    const key = pieCategoryKey(selected, category);
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
  const distribution = attributes?.ancillaryDistribution as AncillaryObservation[] | undefined;
  if (distribution) return distribution;
  const isolates = attributes?.isolates as
    Array<{ ancillaryData?: AncillaryData; metadata?: AncillaryData }> | undefined;
  return isolates?.map((isolate) => ({ values: isolate.ancillaryData ?? isolate.metadata ?? {}, count: 1 })) ?? [];
}

export function distributionFromAttributes(attributes?: Record<string, unknown>): PieCategory[] {
  return (attributes?.[PIE_DISTRIBUTION_ATTRIBUTE] as PieCategory[] | undefined) ?? [];
}

export function distributionForFields(
  attributes: Record<string, unknown> | undefined,
  fields: readonly string[],
): PieCategory[] {
  const observations = observationsFromAttributes(attributes);
  if (observations.length) return pieDistribution(observations, fields);
  const annotations = readNodeAnnotations(attributes);
  if (fields.length === 1) {
    const counts = categoryCountsForField({}, fields[0], annotations.ancillarySummary);
    if (counts.length)
      return pieDistribution(
        counts.map(({ category, count }) => ({ values: { [fields[0]]: category }, count })),
        fields,
      );
  }
  return pieDistribution([{ values: readNodeAncillaryValues(attributes), count: 1 }], fields);
}

export function normalizedPieFields(fields: readonly string[]): string[] {
  return [...new Set(fields.map((field) => field.trim()).filter(Boolean))].sort();
}

export function pieCategoryKey(fields: readonly string[], category: string): string {
  const selected = normalizedPieFields(fields);
  return pieCategoricalAttributeKey(selected.length === 1 ? selected[0] : JSON.stringify(selected), category);
}

export function pieGroupingForFields(
  fields: readonly string[],
  grouping: PieCategoryGrouping = {},
): PieCategoryGrouping {
  return Object.fromEntries(
    Object.entries(grouping).map(([category, mode]) => [pieCategoryKey(fields, category), mode]),
  );
}
