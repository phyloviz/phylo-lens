export interface GraphSearchRequestDto {
  dataset_id: string;
  layout_version?: string | null;
  query: string;
  limit?: number;
}
