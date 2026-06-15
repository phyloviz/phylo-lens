export const PIE_ATTRIBUTE_PREFIX = "pie__";
export const PIE_PALETTE_ATTRIBUTE = "__pie_palette";
export const PIE_CATEGORY_COLORS_ATTRIBUTE = "__pie_category_colors";
export const PIE_FIELD_VALUE_SEPARATOR = "__value__";
export const PIE_OTHER_SLICE_KEY = `${PIE_ATTRIBUTE_PREFIX}others`;
export const PIE_OTHER_SLICE_LABEL = "Others";
export const PIE_OTHER_SLICE_COLOR = "#d3d3d3";
export const CATEGORY_COUNT_FIELD_PREFIX = "__category_count__";
export const CATEGORY_COUNT_FIELD_SEPARATOR = "__value__";
// @sigma/node-piechart emits one WebGL shader program per slice set and uses
// one vertex attribute per slice value. Keep this below common WebGL attribute
// limits so high-cardinality fields render as top categories + Others.
export const MAX_PIE_SLICE_KEYS = 12;

export const DEFAULT_PIE_PALETTE = [
  "#ef4444",
  "#f59e0b",
  "#14b8a6",
  "#0ea5e9",
  "#8b5cf6",
  "#84cc16",
  "#f97316",
  "#ec4899",
];

export interface PieMappingOptions {
  enabled?: boolean;
  fields?: string[];
  palette?: string[];
  categoryColors?: Record<string, string>;
}

type MetadataRecord = Record<string, string | number | boolean | null>;
export type AncillaryRow = Record<string, string | number | boolean | null>;

export interface CategoryCountEntry {
  fieldKey: string;
  category: string;
  count: number;
}

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
  const selectedFields = (options.fields ?? Object.keys(metadata)).filter(
    (fieldKey) => !excluded.has(fieldKey),
  );

  const attributes: Record<string, number> = {};
  const combinationCounts = categoryCountsForFieldCombination(
    ancillaryRows,
    selectedFields,
  );
  if (combinationCounts.length > 0) {
    combinationCounts.forEach((entry) => {
      attributes[pieCategoricalAttributeKey(entry.fieldKey, entry.category)] =
        entry.count;
    });
    return attributes;
  }

  selectedFields.forEach((fieldKey) => {
    const categoryCounts = categoryCountsForField(metadata, fieldKey);
    if (categoryCounts.length > 0) {
      categoryCounts.forEach((entry) => {
        attributes[pieCategoricalAttributeKey(fieldKey, entry.category)] =
          entry.count;
      });
      return;
    }

    const value = metadata[fieldKey];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      attributes[`${PIE_ATTRIBUTE_PREFIX}${fieldKey}`] = value;
      return;
    }

    if (
      !options.fields ||
      value === undefined ||
      value === null ||
      value === ""
    ) {
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
  const selectedFields = options.fields.filter(
    (fieldKey) => !excluded.has(fieldKey),
  );
  const combinationCounts = categoryCountsForFieldCombination(
    ancillaryRows,
    selectedFields,
  );
  if (combinationCounts.length > 0) {
    combinationCounts.forEach((entry) => {
      const color = options.categoryColors?.[entry.category];
      if (typeof color === "string" && /^#[0-9a-fA-F]{6}$/.test(color)) {
        colorsByAttribute[
          pieCategoricalAttributeKey(entry.fieldKey, entry.category)
        ] = color;
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
          colorsByAttribute[
            pieCategoricalAttributeKey(fieldKey, entry.category)
          ] = color;
        }
      });
      return;
    }

    const value = metadata[fieldKey];
    if (
      typeof value === "number" ||
      value === undefined ||
      value === null ||
      value === ""
    ) {
      return;
    }

    categoricalPieValues(value).forEach((category) => {
      const color = options.categoryColors?.[category];
      if (typeof color === "string" && /^#[0-9a-fA-F]{6}$/.test(color)) {
        colorsByAttribute[pieCategoricalAttributeKey(fieldKey, category)] =
          color;
      }
    });
  });

  return colorsByAttribute;
}

export function categoricalPieValues(
  value: string | number | boolean | null | undefined,
): string[] {
  if (value === undefined || value === null || value === "") {
    return [];
  }

  if (typeof value !== "string") {
    return [String(value)];
  }

  const parts = value
    .split(/[;|]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (parts.length <= 1) {
    return [value.trim()].filter((part) => part.length > 0);
  }

  return [...new Set(parts)];
}

export function pieCategoricalAttributeKey(
  fieldKey: string,
  value: string,
): string {
  return `${PIE_ATTRIBUTE_PREFIX}${safeAttributeToken(fieldKey)}${PIE_FIELD_VALUE_SEPARATOR}${safeAttributeToken(value)}`;
}

export function categoryCountsForField(
  metadata: MetadataRecord,
  fieldKey: string,
): CategoryCountEntry[] {
  return Object.entries(metadata)
    .map(([key, value]) => parseCategoryCountMetadataEntry(key, value))
    .filter(
      (entry): entry is CategoryCountEntry =>
        entry !== null && entry.fieldKey === fieldKey,
    )
    .sort(
      (left, right) =>
        right.count - left.count || left.category.localeCompare(right.category),
    );
}

export function categoryCountsForFieldCombination(
  rows: AncillaryRow[],
  fieldKeys: string[],
): CategoryCountEntry[] {
  const selectedFields = fieldKeys
    .map((fieldKey) => fieldKey.trim())
    .filter(Boolean);
  if (selectedFields.length <= 1 || rows.length === 0) {
    return [];
  }

  const fieldKey = combinationPieFieldKey(selectedFields);
  const countsByCategory = new Map<string, number>();
  rows.forEach((row) => {
    combinationLabelsForRow(row, selectedFields).forEach((category) => {
      countsByCategory.set(category, (countsByCategory.get(category) ?? 0) + 1);
    });
  });

  return [...countsByCategory.entries()]
    .map(([category, count]) => ({
      fieldKey,
      category,
      count,
    }))
    .sort(
      (left, right) =>
        right.count - left.count || left.category.localeCompare(right.category),
    );
}

export function combinationPieFieldKey(fieldKeys: string[]): string {
  return fieldKeys
    .map((fieldKey) => fieldKey.trim())
    .filter(Boolean)
    .join(" + ");
}

function combinationLabelsForRow(
  row: AncillaryRow,
  fieldKeys: string[],
): string[] {
  const valuesByField = fieldKeys.map((fieldKey) => {
    const values = categoricalPieValues(row[fieldKey]);
    return values.map((value) => `${fieldKey}:${value}`);
  });

  if (valuesByField.some((values) => values.length === 0)) {
    return [];
  }

  return valuesByField.reduce<string[]>(
    (combinations, values) =>
      combinations.flatMap((combination) =>
        values.map((value) =>
          combination.length > 0 ? `${combination} ${value}` : value,
        ),
      ),
    [""],
  );
}

export function isCategoryCountMetadataKey(key: string): boolean {
  return parseCategoryCountMetadataKey(key) !== null;
}

function parseCategoryCountMetadataEntry(
  key: string,
  value: string | number | boolean | null,
): CategoryCountEntry | null {
  const parsedKey = parseCategoryCountMetadataKey(key);
  if (!parsedKey || typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  if (value <= 0) {
    return null;
  }

  return {
    ...parsedKey,
    count: value,
  };
}

function parseCategoryCountMetadataKey(
  key: string,
): Omit<CategoryCountEntry, "count"> | null {
  if (!key.startsWith(CATEGORY_COUNT_FIELD_PREFIX)) {
    return null;
  }

  const withoutPrefix = key.slice(CATEGORY_COUNT_FIELD_PREFIX.length);
  const separatorIndex = withoutPrefix.indexOf(CATEGORY_COUNT_FIELD_SEPARATOR);
  if (separatorIndex < 0) {
    return null;
  }

  const encodedField = withoutPrefix.slice(0, separatorIndex);
  const encodedCategory = withoutPrefix.slice(
    separatorIndex + CATEGORY_COUNT_FIELD_SEPARATOR.length,
  );

  try {
    return {
      fieldKey: decodeURIComponent(encodedField),
      category: decodeURIComponent(encodedCategory),
    };
  } catch {
    return null;
  }
}

function safeAttributeToken(value: string): string {
  const readableToken = value
    .trim()
    .replaceAll(/[^a-zA-Z0-9_-]+/g, "_")
    .replaceAll(/^_+|_+$/g, "")
    .slice(0, 48);
  return `${readableToken || "blank"}_${hashString(value)}`;
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

// Detect all pie attribute keys used by the incoming graph snapshot.
export function detectPieSliceKeys(
  nodes: Array<{ attributes?: Record<string, unknown> }>,
  maxSliceKeys = MAX_PIE_SLICE_KEYS,
): string[] {
  const totalsByKey = new Map<string, number>();
  nodes.forEach((node) => {
    const attributes = node.attributes;
    if (!attributes) {
      return;
    }

    Object.keys(attributes).forEach((key) => {
      if (!key.startsWith(PIE_ATTRIBUTE_PREFIX)) {
        return;
      }

      const rawValue = attributes[key];
      if (
        typeof rawValue === "number" &&
        Number.isFinite(rawValue) &&
        rawValue > 0
      ) {
        totalsByKey.set(key, (totalsByKey.get(key) ?? 0) + rawValue);
      }
    });
  });

  const sortedKeys = [...totalsByKey.entries()]
    .sort(
      ([leftKey, leftTotal], [rightKey, rightTotal]) =>
        rightTotal - leftTotal || leftKey.localeCompare(rightKey),
    )
    .map(([key]) => key);
  const safeLimit = Math.max(0, maxSliceKeys);
  const hasOverflow = sortedKeys.length > safeLimit;
  const displayedKeyLimit = hasOverflow
    ? Math.max(0, safeLimit - 1)
    : safeLimit;
  const topKeys = sortedKeys.slice(0, displayedKeyLimit);

  if (hasOverflow && safeLimit > 0) {
    topKeys.push(PIE_OTHER_SLICE_KEY);
  }

  return topKeys.sort((left, right) => left.localeCompare(right));
}

// Build a palette large enough for the detected number of slices.
export function buildPiePalette(
  count: number,
  requestedPalette?: string[],
): string[] {
  if (count <= 0) {
    return [];
  }

  const seed =
    requestedPalette && requestedPalette.length > 0
      ? requestedPalette
      : DEFAULT_PIE_PALETTE;

  const colors: string[] = [];
  for (let index = 0; index < count; index += 1) {
    if (index < seed.length) {
      colors.push(seed[index] as string);
      continue;
    }

    const hue = (index * 137.508) % 360;
    colors.push(hslToHex(hue, 70, 52));
  }

  return colors;
}

function hslToHex(
  hue: number,
  saturationPercent: number,
  lightnessPercent: number,
): string {
  const saturation = saturationPercent / 100;
  const lightness = lightnessPercent / 100;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const huePrime = (((hue % 360) + 360) % 360) / 60;
  const x = chroma * (1 - Math.abs((huePrime % 2) - 1));

  let red = 0;
  let green = 0;
  let blue = 0;

  if (huePrime < 1) {
    red = chroma;
    green = x;
  } else if (huePrime < 2) {
    red = x;
    green = chroma;
  } else if (huePrime < 3) {
    green = chroma;
    blue = x;
  } else if (huePrime < 4) {
    green = x;
    blue = chroma;
  } else if (huePrime < 5) {
    red = x;
    blue = chroma;
  } else {
    red = chroma;
    blue = x;
  }

  const match = lightness - chroma / 2;
  return `#${hexChannel(red + match)}${hexChannel(green + match)}${hexChannel(
    blue + match,
  )}`;
}

function hexChannel(value: number): string {
  return Math.round(Math.min(1, Math.max(0, value)) * 255)
    .toString(16)
    .padStart(2, "0");
}
