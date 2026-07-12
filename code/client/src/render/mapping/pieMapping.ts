import {
  PIE_ATTRIBUTE_PREFIX,
  type AncillaryRow,
  type MetadataRecord,
  type PieMappingOptions,
} from "./pieMapping.types";
import {
  categoricalPieValues,
  categoryCountsForField,
  categoryCountsForFieldCombination,
  pieCategoricalAttributeKey,
} from "./pieCategoryCounts";

export * from "./pieMapping.types";
export * from "./pieCategoryCounts";
export * from "./pieColors";

// Build dynamic pie slice attributes from ancillary metadata.
export function buildPieAttributes(
  metadata: MetadataRecord,
  options: PieMappingOptions,
  excludedFields: string[] = [],
  ancillaryRows: AncillaryRow[] = [],
): Record<string, number> {
  if (options.enabled === false) {
    return {};
  }

  const excluded = new Set<string>(excludedFields);
  const selectedFields = (options.fields ?? Object.keys(metadata)).filter((fieldKey) => !excluded.has(fieldKey));

  const attributes: Record<string, number> = {};
  const combinationCounts = categoryCountsForFieldCombination(ancillaryRows, selectedFields);
  if (combinationCounts.length > 0) {
    combinationCounts.forEach((entry) => {
      attributes[pieCategoricalAttributeKey(entry.fieldKey, entry.category)] = entry.count;
    });
    return attributes;
  }

  selectedFields.forEach((fieldKey) => {
    const categoryCounts = categoryCountsForField(metadata, fieldKey);
    if (categoryCounts.length > 0) {
      categoryCounts.forEach((entry) => {
        attributes[pieCategoricalAttributeKey(fieldKey, entry.category)] = entry.count;
      });
      return;
    }

    const value = metadata[fieldKey];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      attributes[`${PIE_ATTRIBUTE_PREFIX}${fieldKey}`] = value;
      return;
    }

    if (!options.fields || value === undefined || value === null || value === "") {
      return;
    }

    categoricalPieValues(value).forEach((category) => {
      attributes[pieCategoricalAttributeKey(fieldKey, category)] = 1;
    });
  });

  return attributes;
}

export function buildPieCategoryColorAttributes(
  metadata: MetadataRecord,
  options: PieMappingOptions,
  excludedFields: string[] = [],
  ancillaryRows: AncillaryRow[] = [],
): Record<string, string> {
  if (options.enabled === false || !options.fields || !options.categoryColors) {
    return {};
  }

  const excluded = new Set<string>(excludedFields);
  const colorsByAttribute: Record<string, string> = {};
  const selectedFields = options.fields.filter((fieldKey) => !excluded.has(fieldKey));
  const combinationCounts = categoryCountsForFieldCombination(ancillaryRows, selectedFields);
  if (combinationCounts.length > 0) {
    combinationCounts.forEach((entry) => {
      const color = options.categoryColors?.[entry.category];
      if (typeof color === "string" && /^#[0-9a-fA-F]{6}$/.test(color)) {
        colorsByAttribute[pieCategoricalAttributeKey(entry.fieldKey, entry.category)] = color;
      }
    });
    return colorsByAttribute;
  }

  selectedFields.forEach((fieldKey) => {
    const categoryCounts = categoryCountsForField(metadata, fieldKey);
    if (categoryCounts.length > 0) {
      categoryCounts.forEach((entry) => {
        const color = options.categoryColors?.[entry.category];
        if (typeof color === "string" && /^#[0-9a-fA-F]{6}$/.test(color)) {
          colorsByAttribute[pieCategoricalAttributeKey(fieldKey, entry.category)] = color;
        }
      });
      return;
    }

    const value = metadata[fieldKey];
    if (typeof value === "number" || value === undefined || value === null || value === "") {
      return;
    }

    categoricalPieValues(value).forEach((category) => {
      const color = options.categoryColors?.[category];
      if (typeof color === "string" && /^#[0-9a-fA-F]{6}$/.test(color)) {
        colorsByAttribute[pieCategoricalAttributeKey(fieldKey, category)] = color;
      }
    });
  });

  return colorsByAttribute;
}
