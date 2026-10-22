import type { DatasetId, LayoutVersion } from './graphIdentifiers';
import type { GraphLayoutBounds } from './viewport/GraphLayoutBounds';

export type GraphComponent = {
  readonly id: string;
  readonly nodeCount: number;
  readonly bounds: GraphLayoutBounds;
};
export type GraphComponentsRequest = {
  readonly datasetId: DatasetId;
  readonly layoutVersion?: LayoutVersion | null;
  readonly after?: number;
  readonly limit?: number;
};
export type GraphComponentsResult = {
  readonly components: readonly GraphComponent[];
  readonly nextCursor: number | null;
};
