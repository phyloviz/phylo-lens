export type MetadataValue = string | number | boolean | null;

export type NodeMetadata = Record<string, MetadataValue>;

export interface CategoricalFieldFilter {
  fieldKey: string;
  acceptedValues: string[];
}

export interface NumericFieldFilter {
  fieldKey: string;
  min?: number;
  max?: number;
}

export interface MetadataFilterState {
  categorical: CategoricalFieldFilter[];
  numeric: NumericFieldFilter[];
}

export interface NumericStats {
  min: number;
  max: number;
}
