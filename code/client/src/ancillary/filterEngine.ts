import type { CategoricalFieldFilter, AncillaryFilterState, AncillaryData, NumericFieldFilter } from "./ancillaryTypes";

export const EMPTY_ANCILLARY_FILTER_STATE: AncillaryFilterState = {
  categorical: [],
  numeric: [],
};

export function matchesFilterState(
  ancillaryData: AncillaryData | null | undefined,
  filterState: AncillaryFilterState,
): boolean {
  return (
    matchesCategoricalFilters(ancillaryData, filterState.categorical) &&
    matchesNumericFilters(ancillaryData, filterState.numeric)
  );
}

function matchesCategoricalFilters(
  ancillaryData: AncillaryData | null | undefined,
  filters: CategoricalFieldFilter[],
): boolean {
  for (const filter of filters) {
    if (filter.acceptedValues.length === 0) {
      continue;
    }

    const value = ancillaryData?.[filter.fieldKey];

    if (value == null || !filter.acceptedValues.includes(String(value))) {
      return false;
    }
  }

  return true;
}

function matchesNumericFilters(
  ancillaryData: AncillaryData | null | undefined,
  filters: NumericFieldFilter[],
): boolean {
  for (const filter of filters) {
    if (filter.min == null && filter.max == null) {
      continue;
    }

    const value = ancillaryData?.[filter.fieldKey];

    if (
      typeof value !== "number" ||
      (filter.min != null && value < filter.min) ||
      (filter.max != null && value > filter.max)
    ) {
      return false;
    }
  }

  return true;
}

export function hasActiveFilters(filterState: AncillaryFilterState): boolean {
  return (
    filterState.categorical.some((filter) => filter.acceptedValues.length > 0) ||
    filterState.numeric.some((filter) => filter.min != null || filter.max != null)
  );
}
