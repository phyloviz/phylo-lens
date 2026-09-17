// Shared categorical colors are independent of viewport frequencies.
export const DEFAULT_COLOR_PALETTE = [
  "#f97316", // orange
  "#0ea5e9", // sky blue
  "#8b5cf6", // violet
  "#f59e0b", // amber
  "#15803d", // green
  "#ec4899", // pink
  "#0f766e", // teal
  "#84cc16", // lime
  "#dc2626", // red
  "#6366f1", // indigo
  "#a16207", // brown
  "#64748b", // slate
];
export const DEFAULT_FALLBACK_COLOR = "#64748b";

// Colour used for values ranked beyond the palette (the "Others" bucket).
export const OTHERS_COLOR = "#d3d3d3";

export function buildValueColorMap(
  values: Array<string | number | boolean | null | undefined>,
  palette: string[],
): (value: string | number | boolean | null | undefined) => string {
  const colors = new Map(values.map((value) => [value, deriveColor(value, palette)]));
  return (value) => colors.get(value) ?? deriveColor(value, palette);
}

export function deriveColor(rawValue: string | number | boolean | null | undefined, palette: string[]): string {
  if (rawValue === undefined || rawValue === null || rawValue === "") {
    return DEFAULT_FALLBACK_COLOR;
  }

  const activePalette = palette.length ? palette : DEFAULT_COLOR_PALETTE;
  const value = String(rawValue);
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  const paletteIndex = hash % activePalette.length;
  const seed = activePalette[paletteIndex] ?? DEFAULT_FALLBACK_COLOR;
  // A secondary tone distinguishes values that share a palette slot without
  // changing their colors when other categories enter or leave the viewport.
  const tone = (((hash >>> 8) % 101) - 50) / 250;
  return `#${[1, 3, 5]
    .map((offset) => {
      const channel = Number.parseInt(seed.slice(offset, offset + 2), 16);
      return Math.round(tone < 0 ? channel * (1 + tone) : channel + (255 - channel) * tone)
        .toString(16)
        .padStart(2, "0");
    })
    .join("")}`;
}
