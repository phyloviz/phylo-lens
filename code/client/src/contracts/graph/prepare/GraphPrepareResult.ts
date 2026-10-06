import type { DatasetId, LayoutVersion } from '../graphIdentifiers';
import { GraphLayoutStatus } from '../graphTypes';

export type GraphPrepareResult = {
  readonly datasetId: DatasetId;
  readonly layoutVersion: LayoutVersion;
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly clusterCount: number;
  readonly lodTierCount?: number;
  readonly layoutStatus: GraphLayoutStatus;
  readonly warnings: readonly string[];
};
