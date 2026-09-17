import type { AncillaryData } from "../../contracts/ancillary";
export type { AncillaryData } from "../../contracts/ancillary";
export const PIE_ATTRIBUTE_PREFIX = "pie__";
export const PIE_GROUPING_ATTRIBUTE = "__pie_grouping";
export const PIE_PALETTE_ATTRIBUTE = "__pie_palette";
export const PIE_CATEGORY_COLORS_ATTRIBUTE = "__pie_category_colors";
export const PIE_FIELD_VALUE_SEPARATOR = "__value__";
export const PIE_OTHER_SLICE_KEY = `${PIE_ATTRIBUTE_PREFIX}others`;
export const PIE_OTHER_SLICE_LABEL = "Other (grouped)";
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

/** Category identities match categoryColors; omitted entries use frequency ranking. */
export type PieCategoryGrouping = Record<string, "separate" | "other">;

export interface PieMappingOptions {
  enabled?: boolean;
  fields?: string[];
  palette?: string[];
  categoryColors?: Record<string, string>;
  /** Separate choices reserve up to 11 slots in stable key order, even offscreen.
   * Excess choices and categories marked other aggregate in the gray Other slice.
   * For multiple fields, keys are the observed combination identities from pieDistribution.
   */
  categoryGrouping?: PieCategoryGrouping;
}

/** @deprecated Use AncillaryData. */
export type MetadataRecord = AncillaryData;
export type AncillaryRow = AncillaryData;

export interface CategoryCountEntry {
  fieldKey: string;
  category: string;
  count: number;
}

export const PIE_DISTRIBUTION_ATTRIBUTE = "pieDistribution";
export const MISSING_PIE_CATEGORY = "\u0000missing";
export interface PieCategory {
  key: string;
  category: string;
  label: string;
  value: number;
  missing?: boolean;
}
