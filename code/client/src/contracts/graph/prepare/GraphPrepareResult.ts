import type { DatasetId, LayoutVersion } from "../graphIdentifiers";
import { GraphLayoutStatus } from "../graphTypes";

export interface GraphPrepareResult {
  datasetId: DatasetId;
  layoutVersion: LayoutVersion;
  nodeCount: number;
  edgeCount: number;
  clusterCount: number;
  lodTierCount?: number;
  layoutStatus: GraphLayoutStatus;
  warnings: string[];
}
