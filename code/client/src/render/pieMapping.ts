export const PIE_ATTRIBUTE_PREFIX = "pie__";
export const PIE_PALETTE_ATTRIBUTE = "__pie_palette";

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
}

// Build dynamic pie slice attributes from numeric ancillary metadata.
export function buildPieAttributes(
  metadata: Record<string, string | number | boolean | null>,
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
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      return;
    }

    const attributeKey = `${PIE_ATTRIBUTE_PREFIX}${fieldKey}`;
    attributes[attributeKey] = value;
  });

  return attributes;
}

// Detect all pie attribute keys used by the incoming graph snapshot.
export function detectPieSliceKeys(
  nodes: Array<{ attributes?: Record<string, unknown> }>,
): string[] {
  const keys = new Set<string>();
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
        keys.add(key);
      }
    });
  });

  return [...keys].sort((left, right) => left.localeCompare(right));
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
