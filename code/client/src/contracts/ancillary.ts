/** User-supplied observations; computed profile counts do not belong here. */
export type AncillaryValue = string | number | boolean | null;
export type AncillaryData = Readonly<Record<string, AncillaryValue>>;
export type AncillaryType = 'string' | 'number' | 'boolean' | 'null';
export type AncillaryField = {
  readonly key: string;
  readonly type: AncillaryType;
};
export type AncillarySummary = {
  readonly values: AncillaryData;
  readonly categoryCounts: Readonly<Record<string, Readonly<Record<string, number>>>>;
};
export type ProfileSummary = {
  readonly isolateCount?: number;
};
export type NodeAnnotations = {
  readonly ancillaryData: AncillaryData;
  readonly ancillarySummary: AncillarySummary;
  readonly profileSummary: ProfileSummary;
};
export type Isolate = {
  readonly id: string;
  readonly ancillaryData: AncillaryData;
};
export type AncillaryTableInput = {
  readonly content: string;
  readonly joinColumn: string;
  readonly format: 'auto' | 'csv' | 'tsv';
};

/** A joint observation shared by count represented isolates. */
export type AncillaryObservation = {
  readonly values: AncillaryData;
  readonly count: number;
};

export type AncillaryDataInput = {
  readonly content: string;
  readonly joinColumn: string;
  readonly format?: 'auto' | 'csv' | 'tsv';
};
