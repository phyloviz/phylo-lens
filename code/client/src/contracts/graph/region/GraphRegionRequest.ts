import type { DatasetId, LayoutVersion } from '../graphIdentifiers';
export type GraphRegionRequest = {
  readonly datasetId: DatasetId;
  readonly layoutVersion?: LayoutVersion | null;
  readonly xmin: number;
  readonly xmax: number;
  readonly ymin: number;
  readonly ymax: number;
  readonly maxNodes?: number | null;
};
