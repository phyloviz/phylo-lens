export interface AncillaryDataInputDto {
  content: string;
  join_column: string;
  format?: 'auto' | 'csv' | 'tsv';
}
