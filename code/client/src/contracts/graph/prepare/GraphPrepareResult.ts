import type { DatasetId, LayoutVersion } from '../graphIdentifiers';
import { GraphLayoutStatus } from '../graphTypes';
import type { TypingOptions } from '../TypingOptions';

export type GraphPrepareResult = {
  readonly typingOptions?: TypingOptions;
  readonly distanceCutoff?: number;
  readonly datasetId: DatasetId;
  readonly layoutVersion: LayoutVersion;
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly clusterCount: number;
  readonly lodTierCount?: number;
  readonly technicalRoots?: readonly string[];
  readonly layoutStatus: GraphLayoutStatus;
  readonly warnings: readonly string[];
};
