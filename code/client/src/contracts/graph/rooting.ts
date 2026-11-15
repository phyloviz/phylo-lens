import type { DatasetId, LayoutVersion, NodeId } from './graphIdentifiers';
import type { GraphPrepareResult } from './prepare/GraphPrepareResult';

export type GraphRootingRequest = {
  readonly datasetId: DatasetId;
  readonly layoutVersion: LayoutVersion;
  /** Null restores the original preparation roots in every component. */
  readonly nodeId: NodeId | null;
};

export type GraphRootingResult = GraphPrepareResult & {
  readonly technicalRoots: readonly string[];
  readonly defaultRoots: readonly string[];
  readonly componentIds: Readonly<Record<string, string>>;
};
