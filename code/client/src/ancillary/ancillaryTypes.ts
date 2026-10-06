export type { AncillaryData, AncillaryValue } from '../contracts/ancillary';

export type CategoricalFieldFilter = {
  readonly fieldKey: string;
  readonly acceptedValues: readonly string[];
};

export type NumericFieldFilter = {
  readonly fieldKey: string;
  readonly min?: number;
  readonly max?: number;
};

export type AncillaryFilterState = {
  readonly categorical: readonly CategoricalFieldFilter[];
  readonly numeric: readonly NumericFieldFilter[];
};
