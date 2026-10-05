import type { GraphLayoutStatus } from "../../../../contracts/graph/graphTypes";

export interface GraphPrepareResponseDto {
  dataset_id: string;
  layout_version: string;
  node_count: number;
  edge_count: number;
  cluster_count: number;
  lod_tier_count?: number;
  layout_status: GraphLayoutStatus;
  warnings: string[];
}
