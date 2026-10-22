export interface GraphSearchRequestDto {
  component_id?: string;
  dataset_id: string;
  layout_version?: string | null;
  query: string;
  limit?: number;
}
