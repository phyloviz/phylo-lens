import type { PieMappingOptions } from "./pieMapping";

export { UNION_NODE_COLOR, UNION_NODE_SIZE } from "./unionNodes";
export {
  buildValueColorMap,
  DEFAULT_COLOR_PALETTE,
  DEFAULT_FALLBACK_COLOR,
  deriveColor,
  OTHERS_COLOR,
} from "./colorMapping";

export const DEFAULT_NODE_SIZE = 5;
export const MIN_NODE_SIZE = 4;
// A wide upper bound so metadata-driven sizing is clearly legible and the
// difference between linear and logarithmic scaling is visible on the canvas
// (a narrow 3-10px span made both scales look nearly identical).
export const MAX_NODE_SIZE = 22;
export const DEFAULT_SIZE_FIELD = "distance";
export const DEFAULT_PROFILE_COUNT_FIELD = "profile_count";
export const SIZE_SCALE_LINEAR = "linear";
export const SIZE_SCALE_LOG = "log";

export type SizeScale = typeof SIZE_SCALE_LINEAR | typeof SIZE_SCALE_LOG;

export interface SizeMappingOptions {
  field?: string;
  scale?: SizeScale;
}

export interface VisualMappingOptions {
  colorField?: string;
  sizeField?: string;
  size?: SizeMappingOptions;
  palette?: string[];
  pie?: PieMappingOptions;
}

// Metadata coloring is opt-in; schema order must not choose the scientific meaning of color.
export function resolveColorField(requestedColorField: string | undefined): string | undefined {
  return requestedColorField?.trim() || undefined;
}

// Pick the default size field when no explicit size mapping is set. Prefer the
// isolate/profile count so nodes size by how much isolate data they carry (as
// in PHYLOViZ), falling back to branch distance when profile counts are absent.
export function resolveDefaultSizeField(hasProfileCount: boolean): string {
  return hasProfileCount ? DEFAULT_PROFILE_COUNT_FIELD : DEFAULT_SIZE_FIELD;
}

// Derive node size from numeric metadata using min-max normalization.
export function deriveSize(
  rawValue: string | number | boolean | null | undefined,
  stats: { min: number; max: number } | undefined,
  scale: SizeScale,
): number {
  const value = numericMetadataValue(rawValue);
  if (value === null || !stats) {
    return DEFAULT_NODE_SIZE;
  }

  return scaleNumberToRange(value, stats.min, stats.max, MIN_NODE_SIZE, MAX_NODE_SIZE, scale, DEFAULT_NODE_SIZE);
}

// Metadata stored by older prepared layouts can retain numeric cells as JSON
// strings. Treat finite numeric strings exactly like JSON numbers so changing
// the scale remains effective across both payload shapes.
export function numericMetadataValue(value: string | number | boolean | null | undefined): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function scaleNumberToRange(
  value: number,
  min: number,
  max: number,
  outputMin: number,
  outputMax: number,
  scale: SizeScale,
  fallback: number,
): number {
  if (!Number.isFinite(value) || max === min) {
    return fallback;
  }

  const normalized = scale === SIZE_SCALE_LOG ? normalizeLogValue(value, min, max) : (value - min) / (max - min);
  const clamped = Math.min(1, Math.max(0, normalized));
  return outputMin + clamped * (outputMax - outputMin);
}

function normalizeLogValue(value: number, min: number, max: number): number {
  const safeMin = Math.max(0, min);
  const safeMax = Math.max(0, max);
  if (safeMax === safeMin) {
    return 0;
  }

  const transformedValue = Math.log1p(Math.max(0, value));
  const transformedMin = Math.log1p(safeMin);
  const transformedMax = Math.log1p(safeMax);
  return (transformedValue - transformedMin) / (transformedMax - transformedMin);
}
