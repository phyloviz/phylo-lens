import { distributionForFields, distributionFromAttributes } from "./pieDistribution";
import { readNodeAncillaryValues } from "../../ancillary/ancillaryAccess";
import { deriveColor, DEFAULT_COLOR_PALETTE } from "./colorMapping";
import {
  PIE_ATTRIBUTE_PREFIX,
  PIE_CATEGORY_COLORS_ATTRIBUTE,
  PIE_OTHER_SLICE_COLOR,
  PIE_OTHER_SLICE_KEY,
  PIE_PALETTE_ATTRIBUTE,
  MAX_PIE_SLICE_KEYS,
  DEFAULT_PIE_PALETTE,
} from "./pieMapping.types";

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
  const palette = requestedPalette?.length
    ? requestedPalette
    : (resolvePiePaletteFromNodes(nodes) ?? DEFAULT_COLOR_PALETTE);
  const overrides = collectPieCategoryColors(nodes);
  const categories = new Map(
    nodes.flatMap((node) => {
      const stored = distributionFromAttributes(node.attributes);
      const slices = stored.length
        ? stored
        : Object.keys(readNodeAncillaryValues(node.attributes)).flatMap((field) =>
            distributionForFields(node.attributes, [field]),
          );
      return slices.map((slice) => [slice.key, slice] as const);
    }),
  );
  return Object.fromEntries(
    sliceKeys.map((key) => {
      if (key === PIE_OTHER_SLICE_KEY) return [key, PIE_OTHER_SLICE_COLOR];
      const slice = categories.get(key);
      const requested = requestedCategoryColors?.[slice?.category ?? key] ?? overrides[key];
      const override = requested && /^#[0-9a-fA-F]{6}$/.test(requested) ? requested : undefined;
      return [key, override ?? (slice?.missing ? "#94a3b8" : deriveColor(slice?.category ?? key, palette))];
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
