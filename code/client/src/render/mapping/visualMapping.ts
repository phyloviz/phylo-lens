import { DEFAULT_COLOR_PALETTE } from './colorMapping';
import type { PieMappingOptions } from './pieMapping';

export { UNION_NODE_COLOR, UNION_NODE_SIZE } from './unionNodes';
export {
  buildValueColorMap,
  DEFAULT_COLOR_PALETTE,
  DEFAULT_FALLBACK_COLOR,
  deriveColor,
  OTHERS_COLOR,
} from './colorMapping';

// Sigma sizes are radii. Both scales add a value-dependent increment to
// this fixed base radius, keeping sizes independent of viewport contents.
export const DEFAULT_NODE_SIZE = 3;
export const NODE_SIZE_VALUE_FACTOR = 1.2;
export const DEFAULT_SIZE_FIELD = 'distance';
export const DEFAULT_PROFILE_COUNT_FIELD = 'profile_count';
export const SIZE_SCALE_LINEAR = 'linear';
export const SIZE_SCALE_LOG = 'log';

export type SizeScale = typeof SIZE_SCALE_LINEAR | typeof SIZE_SCALE_LOG;

export type SizeMappingOptions = {
  readonly field?: string;
  /** Fixed radius growth by value or ln(1 + value), independent of the visible slice. */
  readonly scale?: SizeScale;
};

export type VisualMappingOptions = {
  readonly colorField?: string;
  readonly size?: SizeMappingOptions;
  readonly palette?: readonly string[];
  readonly pie?: PieMappingOptions;
};

/** Copy and freeze the small configuration we retain; caller-owned values stay untouched. */
export function copyVisualMapping(mapping: VisualMappingOptions): VisualMappingOptions {
  const copy = { ...mapping };
  if (mapping.size) copy.size = Object.freeze({ ...mapping.size });
  if (mapping.palette) copy.palette = Object.freeze([...mapping.palette]);
  if (mapping.pie) {
    const pie = { ...mapping.pie };
    if (pie.fields) pie.fields = Object.freeze([...pie.fields]);
    if (pie.palette) pie.palette = Object.freeze([...pie.palette]);
    if (pie.categoryColors) pie.categoryColors = Object.freeze({ ...pie.categoryColors });
    if (pie.categoryGrouping) pie.categoryGrouping = Object.freeze({ ...pie.categoryGrouping });
    copy.pie = Object.freeze(pie);
  }
  return Object.freeze(copy);
}

/** Pies, solid fills and legends use one palette, including pie-specific overrides. */
export function resolveMappingPalette(mapping: VisualMappingOptions): readonly string[] {
  return mapping.pie?.palette?.length
    ? mapping.pie.palette
    : mapping.palette?.length
      ? mapping.palette
      : DEFAULT_COLOR_PALETTE;
}

// Metadata coloring is opt-in; schema order must not choose the scientific meaning of color.
export function resolveColorField(requestedColorField: string | undefined): string | undefined {
  return requestedColorField?.trim() || undefined;
}

// Pick the default size field when no explicit size mapping is set. Prefer the
// isolate/profile count so nodes size by how much isolate data they carry,
// falling back to branch distance when profile counts are absent.
export function resolveDefaultSizeField(hasProfileCount: boolean): string {
  return hasProfileCount ? DEFAULT_PROFILE_COUNT_FIELD : DEFAULT_SIZE_FIELD;
}

// Use a fixed base plus frequency without viewport normalization or
// a maximum that would make distinct frequencies look identical.
export function deriveSize(rawValue: string | number | boolean | null | undefined, scale: SizeScale): number {
  const value = numericAncillaryValue(rawValue);
  if (value === null) {
    return DEFAULT_NODE_SIZE;
  }

  const nonNegativeValue = Math.max(0, value);
  const scaledValue = scale === SIZE_SCALE_LOG ? Math.log1p(nonNegativeValue) : nonNegativeValue;
  const size = DEFAULT_NODE_SIZE + NODE_SIZE_VALUE_FACTOR * scaledValue;
  return Number.isFinite(size) ? size : DEFAULT_NODE_SIZE;
}

// Ancillary fields can contain numeric strings. Accept finite numeric values
// when a field is selected explicitly for node sizing.
export function numericAncillaryValue(value: string | number | boolean | null | undefined): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
