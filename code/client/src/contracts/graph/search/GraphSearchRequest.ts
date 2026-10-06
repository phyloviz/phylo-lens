import type { DatasetId, LayoutVersion } from '../graphIdentifiers';
export type GraphSearchRequest = {
  readonly datasetId: DatasetId;
  readonly layoutVersion?: LayoutVersion | null;
  readonly query: string;
  readonly limit?: number;
};
