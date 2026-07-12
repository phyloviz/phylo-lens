// Single source of truth for categorical value -> color mapping. Node fills,
// on-node pies, and ancillary wheels all resolve a value's color through the
// SAME frequency-ranked value->color map here, so the same metadata value is
// painted identically everywhere and distinct values get distinct colors. Kept
// as a dependency-free leaf module to avoid an import cycle between
// visualMappings.ts and pieMapping.ts.

// A palette of visually distinct hues, ordered so the most frequent values take
// the boldest, most separable colours first. Sized to comfortably cover the
// top-12 categories a wheel/legend shows before collapsing the rest to Others.
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

// Build a frequency-ranked value -> colour resolver from the full universe of
// values (one entry per node occurrence, so frequency is captured). Values are
// ranked most-frequent-first (ties broken by label) and assigned palette
// colours in order; values ranked beyond the palette collapse to OTHERS_COLOR.
// This is the shared map node fills, pies, and wheels all consult, guaranteeing
// they agree per value while keeping the top categories visually distinct.
export function buildValueColorMap(
  values: Array<string | number | boolean | null | undefined>,
  palette: string[],
): (value: string | number | boolean | null | undefined) => string {
  const activePalette = palette.length > 0 ? palette : DEFAULT_COLOR_PALETTE;
  const counts = new Map<string, number>();
  for (const raw of values) {
    if (raw === undefined || raw === null || raw === "") {
      continue;
    }
    const value = String(raw);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  const rankedValues = [...counts.entries()]
    .sort(
      ([leftLabel, leftCount], [rightLabel, rightCount]) =>
        rightCount - leftCount || leftLabel.localeCompare(rightLabel),
    )
    .map(([label]) => label);

  const colorByValue = new Map<string, string>();
  rankedValues.forEach((value, rank) => {
    colorByValue.set(value, rank < activePalette.length ? (activePalette[rank] as string) : OTHERS_COLOR);
  });

  return (value) => {
    if (value === undefined || value === null || value === "") {
      return DEFAULT_FALLBACK_COLOR;
    }
    return colorByValue.get(String(value)) ?? OTHERS_COLOR;
  };
}

// Derive a deterministic color from a single categorical value, used only as a
// fallback when the full value universe is unavailable (e.g. a lone node with
// no graph context). Prefer buildValueColorMap wherever the value set is known.
export function deriveColor(rawValue: string | number | boolean | null | undefined, palette: string[]): string {
  if (rawValue === undefined || rawValue === null || palette.length === 0) {
    return DEFAULT_FALLBACK_COLOR;
  }

  const value = String(rawValue);
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  const paletteIndex = hash % palette.length;
  return palette[paletteIndex] ?? DEFAULT_FALLBACK_COLOR;
}
