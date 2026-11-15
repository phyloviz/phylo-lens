export interface AncillaryDataInputDto {
  content: string;
  join_column: string;
  format?: 'auto' | 'csv' | 'tsv';
}

export interface GraphAncillaryRequestDto {
  dataset_id: string;
  layout_version: string;
  ancillary_data: AncillaryDataInputDto;
}

export interface GraphAncillaryResponseDto {
  dataset_id: string;
  layout_version: string;
  matched_node_count: number;
  warnings: string[];
}
