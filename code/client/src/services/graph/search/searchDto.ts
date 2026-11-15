export interface GraphSearchMatchDto {
  node_id: string;
  score: number;
  matched_text: string;
  cluster_id?: string | null;
  x?: number | null;
  y?: number | null;
}

export interface GraphSearchRequestDto {
  component_id?: string;
  dataset_id: string;
  layout_version?: string | null;
  query: string;
  limit?: number;
}

export interface GraphSearchResponseDto {
  dataset_id: string;
  query: string;
  matches: GraphSearchMatchDto[];
  total_count: number;
}
