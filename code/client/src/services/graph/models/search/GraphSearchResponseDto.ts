import type { GraphSearchMatchDto } from "./GraphSearchMatchDto";

export interface GraphSearchResponseDto {
  dataset_id: string;
  query: string;
  matches: GraphSearchMatchDto[];
  total_count: number;
}
