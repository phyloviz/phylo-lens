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

export type MetadataRecord = Record<string, string | number | boolean | null>;
export type AncillaryRow = Record<string, string | number | boolean | null>;

export interface CategoryCountEntry {
  fieldKey: string;
  category: string;
  count: number;
}
