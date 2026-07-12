import { readNodeMetadata } from "../../ancillary/metadataAccess";
import { buildValueColorMap, DEFAULT_COLOR_PALETTE } from "./colorMapping";
import {
  PIE_ATTRIBUTE_PREFIX,
  PIE_CATEGORY_COLORS_ATTRIBUTE,
  PIE_OTHER_SLICE_COLOR,
  PIE_OTHER_SLICE_KEY,
  PIE_PALETTE_ATTRIBUTE,
  MAX_PIE_SLICE_KEYS,
  DEFAULT_PIE_PALETTE,
} from "./pieMapping.types";
import { categoricalPieValues, parseCategoryCountMetadataEntry, pieCategoricalAttributeKey } from "./pieCategoryCounts";

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
      if (typeof rawValue === "number" && Number.isFinite(rawValue) && rawValue > 0) {
        totalsByKey.set(key, (totalsByKey.get(key) ?? 0) + rawValue);
      }
    });
  });

  const sortedKeys = [...totalsByKey.entries()]
    .sort(([leftKey, leftTotal], [rightKey, rightTotal]) => rightTotal - leftTotal || leftKey.localeCompare(rightKey))
    .map(([key]) => key);
  const safeLimit = Math.max(0, maxSliceKeys);
  const hasOverflow = sortedKeys.length > safeLimit;
  const displayedKeyLimit = hasOverflow ? Math.max(0, safeLimit - 1) : safeLimit;
  const topKeys = sortedKeys.slice(0, displayedKeyLimit);

  if (hasOverflow && safeLimit > 0) {
    topKeys.push(PIE_OTHER_SLICE_KEY);
  }

  return topKeys.sort((left, right) => left.localeCompare(right));
}

export function buildPiePalette(count: number, requestedPalette?: string[]): string[] {
  if (count <= 0) {
    return [];
  }

  const seed = requestedPalette && requestedPalette.length > 0 ? requestedPalette : DEFAULT_PIE_PALETTE;

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

export function resolvePieSliceColors(
  nodes: Array<{ attributes?: Record<string, unknown> }>,
  sliceKeys: readonly string[] = detectPieSliceKeys(nodes),
  requestedPalette?: string[],
  // Live per-category overrides from the shell controls, keyed by plain value
  // label (e.g. "Peru"). They are re-keyed to slice keys per field below and
  // take precedence over overrides baked onto the graph, so a colour edit is
  // reflected immediately by every consumer (wheel included).
  requestedCategoryColors?: Record<string, string>,
): Record<string, string> {
  const runtimePalette = resolvePiePaletteFromNodes(nodes);
  const categoryColors = collectPieCategoryColors(nodes);
  // Rank each value by graph-wide frequency and assign palette colours in that
  // order, exactly as the node fill does, so a value's pie slice, wheel slice,
  // and node fill all agree AND the top values stay distinct. User
  // category-colour overrides still win.
  const palette =
    runtimePalette && runtimePalette.length > 0
      ? runtimePalette
      : requestedPalette && requestedPalette.length > 0
        ? requestedPalette
        : DEFAULT_COLOR_PALETTE;
  // Colours are ranked PER FIELD so a country's colour depends only on the
  // country distribution (not pooled with regions etc.), matching how the node
  // fill and the wheel rank a single field.
  const { fieldBySliceKey, valueBySliceKey, valuesByField } = sliceValuesByKey(nodes);
  const colorForValueByField = new Map<string, (value: string | number | boolean | null | undefined) => string>();
  valuesByField.forEach((values, fieldKey) => {
    colorForValueByField.set(fieldKey, buildValueColorMap(values, palette));
  });

  return Object.fromEntries(
    sliceKeys.map((key) => {
      if (key === PIE_OTHER_SLICE_KEY) {
        return [key, PIE_OTHER_SLICE_COLOR];
      }
      const value = valueBySliceKey.get(key);
      // Live label-keyed override wins, then the graph-baked slice-key override.
      const liveOverride = value !== undefined ? requestedCategoryColors?.[value] : undefined;
      const override = liveOverride ?? categoryColors[key];
      if (override) {
        return [key, override];
      }
      const fieldKey = fieldBySliceKey.get(key);
      const resolver = fieldKey ? colorForValueByField.get(fieldKey) : undefined;
      return [key, resolver ? resolver(value) : PIE_OTHER_SLICE_COLOR];
    }),
  );
}

export function collectPieCategoryColors(
  nodes: Array<{ attributes?: Record<string, unknown> }>,
): Record<string, string> {
  const colors: Record<string, string> = {};

  nodes.forEach((node) => {
    const value = node.attributes?.[PIE_CATEGORY_COLORS_ATTRIBUTE];
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return;
    }

    Object.entries(value).forEach(([key, color]) => {
      if (typeof color === "string" && /^#[0-9a-fA-F]{6}$/.test(color)) {
        colors[key] = color;
      }
    });
  });

  return colors;
}

export function resolvePiePaletteFromNodes(
  nodes: Array<{ attributes?: Record<string, unknown> }>,
): string[] | undefined {
  for (const node of nodes) {
    const value = node.attributes?.[PIE_PALETTE_ATTRIBUTE];
    if (!Array.isArray(value)) {
      continue;
    }

    const colors = value.filter(
      (color): color is string => typeof color === "string" && /^#[0-9a-fA-F]{6}$/.test(color),
    );
    if (colors.length > 0) {
      return colors;
    }
  }

  return undefined;
}

function sliceValuesByKey(nodes: Array<{ attributes?: Record<string, unknown> }>): {
  fieldBySliceKey: Map<string, string>;
  valueBySliceKey: Map<string, string>;
  valuesByField: Map<string, string[]>;
} {
  const fieldByKey = new Map<string, string>();
  const valueByKey = new Map<string, string>();
  const valuesByField = new Map<string, string[]>();

  const record = (fieldKey: string, category: string, count: number): void => {
    const sliceKey = pieCategoricalAttributeKey(fieldKey, category);
    fieldByKey.set(sliceKey, fieldKey);
    valueByKey.set(sliceKey, category);
    const bucket = valuesByField.get(fieldKey) ?? [];
    for (let index = 0; index < count; index += 1) {
      bucket.push(category);
    }
    valuesByField.set(fieldKey, bucket);
  };

  nodes.forEach((node) => {
    const metadata = readNodeMetadata(node.attributes);
    if (!metadata) {
      return;
    }
    Object.entries(metadata).forEach(([metadataKey, rawValue]) => {
      const categoryEntry = parseCategoryCountMetadataEntry(metadataKey, rawValue);
      if (categoryEntry) {
        record(categoryEntry.fieldKey, categoryEntry.category, categoryEntry.count);
        return;
      }
      categoricalPieValues(rawValue).forEach((category) => {
        record(metadataKey, category, 1);
      });
    });
  });

  return { fieldBySliceKey: fieldByKey, valueBySliceKey: valueByKey, valuesByField };
}

function hslToHex(hue: number, saturationPercent: number, lightnessPercent: number): string {
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
  return `#${hexChannel(red + match)}${hexChannel(green + match)}${hexChannel(blue + match)}`;
}

function hexChannel(value: number): string {
  return Math.round(Math.min(1, Math.max(0, value)) * 255)
    .toString(16)
    .padStart(2, "0");
}
