export type { AncillaryData, AncillaryValue } from "../contracts/ancillary";

export interface CategoricalFieldFilter {
  fieldKey: string;
  acceptedValues: string[];
}

export interface NumericFieldFilter {
  fieldKey: string;
  min?: number;
  max?: number;
}

export interface AncillaryFilterState {
  categorical: CategoricalFieldFilter[];
  numeric: NumericFieldFilter[];
}

export interface NumericStats {
  min: number;
  max: number;
}
