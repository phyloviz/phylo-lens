export const PIE_ATTRIBUTE_PREFIX = "pie__";
export const PIE_PALETTE_ATTRIBUTE = "__pie_palette";
export const PIE_CATEGORY_COLORS_ATTRIBUTE = "__pie_category_colors";
export const PIE_FIELD_VALUE_SEPARATOR = "__value__";
export const PIE_OTHER_SLICE_KEY = `${PIE_ATTRIBUTE_PREFIX}others`;
export const PIE_OTHER_SLICE_LABEL = "Others";
export const PIE_OTHER_SLICE_COLOR = "#d3d3d3";
// @sigma/node-piechart emits one WebGL shader program per slice set. Keep this
// conservative so high-cardinality fields such as country do not fail linking.
export const MAX_PIE_SLICE_KEYS = 16;

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

// Build dynamic pie slice attributes from ancillary metadata.
export function buildPieAttributes(
  metadata: MetadataRecord,
  options: PieMappingOptions,
  excludedFields: string[] = [],
): Record<string, number> {
  if (options.enabled === false) {
    return {};
  }

  const excluded = new Set<string>(excludedFields);
  const selectedFields = (options.fields ?? Object.keys(metadata)).filter(
    (fieldKey) => !excluded.has(fieldKey),
  );

  const attributes: Record<string, number> = {};
  selectedFields.forEach((fieldKey) => {
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
): Record<string, string> {
  if (options.enabled === false || !options.fields || !options.categoryColors) {
    return {};
  }

  const excluded = new Set<string>(excludedFields);
  const colorsByAttribute: Record<string, string> = {};
  options.fields
    .filter((fieldKey) => !excluded.has(fieldKey))
    .forEach((fieldKey) => {
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
  const topKeys = sortedKeys.slice(0, safeLimit);

  if (sortedKeys.length > safeLimit && safeLimit > 0) {
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

    const hue = Math.round((index * 137.508) % 360);
    colors.push(`hsl(${hue} 70% 52%)`);
  }

  return colors;
}
