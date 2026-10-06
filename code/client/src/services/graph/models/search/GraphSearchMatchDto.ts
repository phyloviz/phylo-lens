export interface GraphSearchMatchDto {
  node_id: string;
  score: number;
  matched_text: string;
  cluster_id?: string | null;
  x?: number | null;
  y?: number | null;
}
