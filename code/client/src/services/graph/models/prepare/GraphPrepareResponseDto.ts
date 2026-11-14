import type { GraphLayoutStatus } from '../../../../contracts/graph/graphTypes';
import type { TypingOptions } from '../../../../contracts/graph/TypingOptions';

export interface GraphPrepareResponseDto {
  typing_options?: TypingOptions | null;
  distance_cutoff?: number | null;
  dataset_id: string;
  layout_version: string;
  node_count: number;
  edge_count: number;
  cluster_count: number;
  lod_tier_count?: number;
  technical_roots?: string[];
  layout_status: GraphLayoutStatus;
  warnings: string[];
}
