import type { SourceFormat } from '../models';

export type DistanceConnectionOptions = { readonly threshold: number; readonly maxConnections?: number };
export type DistanceConnectionsRequest = DistanceConnectionOptions & {
  readonly datasetId: string;
  readonly layoutVersion: string;
  readonly format: SourceFormat;
  readonly content: string;
};
export type DistanceConnection = {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly distance: number;
};
export type DistanceConnectionsResult = {
  readonly metric: 'allelic' | 'patristic';
  readonly threshold: number;
  readonly edges: readonly DistanceConnection[];
};
