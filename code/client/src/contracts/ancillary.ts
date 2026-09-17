/** User-supplied observations; computed profile counts do not belong here. */
export type AncillaryValue = string | number | boolean | null;
export type AncillaryData = Record<string, AncillaryValue>;
export type AncillaryType = "string" | "number" | "boolean" | "null";
export interface AncillaryField {
  key: string;
  type: AncillaryType;
}
export interface AncillarySummary {
  values: AncillaryData;
  categoryCounts: Record<string, Record<string, number>>;
}
export interface ProfileSummary {
  isolateCount?: number;
}
export interface NodeAnnotations {
  ancillaryData: AncillaryData;
  ancillarySummary: AncillarySummary;
  profileSummary: ProfileSummary;
}
export interface Isolate {
  id: string;
  ancillaryData: AncillaryData;
}
export interface AncillaryTableInput {
  content: string;
  join_column: string;
  format: "auto" | "csv" | "tsv";
}

/** A joint observation shared by count represented isolates. */
export interface AncillaryObservation {
  values: AncillaryData;
  count: number;
}
