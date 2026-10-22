import type { DatasetId, LayoutVersion } from './graphIdentifiers';
import type { GraphLayoutBounds } from './viewport/GraphLayoutBounds';

export interface GraphComponent {
  readonly id: string;
  readonly nodeCount: number;
  readonly bounds: GraphLayoutBounds;
}
export interface GraphComponentsRequest {
  readonly datasetId: DatasetId;
  readonly layoutVersion?: LayoutVersion | null;
  readonly after?: number;
  readonly limit?: number;
}
export interface GraphComponentsResult {
  readonly components: readonly GraphComponent[];
  readonly nextCursor: number | null;
}
