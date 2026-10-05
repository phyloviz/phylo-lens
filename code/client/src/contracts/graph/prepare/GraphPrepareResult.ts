import { GraphLayoutStatus } from "../graphTypes";

export interface GraphPrepareResult {
  datasetId: string;
  layoutVersion: string;
  nodeCount: number;
  edgeCount: number;
  clusterCount: number;
  lodTierCount?: number;
  layoutStatus: GraphLayoutStatus;
  warnings: string[];
}
