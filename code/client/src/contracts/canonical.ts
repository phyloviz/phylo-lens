export const SOURCE_FORMAT_NEWICK = "newick";
export const SOURCE_FORMAT_EDGELIST = "edgelist";
export const SOURCE_FORMAT_TYPING_DATA = "typing_data";

export const METADATA_TYPE_STRING = "string";
export const METADATA_TYPE_NUMBER = "number";
export const METADATA_TYPE_BOOLEAN = "boolean";
export const METADATA_TYPE_NULL = "null";

export type SourceFormat =
  | typeof SOURCE_FORMAT_NEWICK
  | typeof SOURCE_FORMAT_EDGELIST
  | typeof SOURCE_FORMAT_TYPING_DATA;

export type MetadataType =
  | typeof METADATA_TYPE_STRING
  | typeof METADATA_TYPE_NUMBER
  | typeof METADATA_TYPE_BOOLEAN
  | typeof METADATA_TYPE_NULL;

export interface MetadataField {
  key: string;
  type: MetadataType;
}

export interface CanonicalNode {
  id: string;
}

export interface CanonicalEdge {
  id: string;
  source: string;
  target: string;
}

export interface DatasetSource {
  format: SourceFormat;
  generated_at: string;
  provenance?: string;
}

export interface CanonicalDataset {
  dataset_id: string;
  nodes: CanonicalNode[];
  edges: CanonicalEdge[];
  metadata_schema: MetadataField[];
  metadata_by_node_id: Record<
    string,
    Record<string, string | number | boolean | null>
  >;
  source: DatasetSource;
}

export interface NormalizeStats {
  node_count: number;
  edge_count: number;
  ingest_ms: number;
  normalize_ms: number;
}

export interface NormalizeResponse {
  dataset: CanonicalDataset;
  stats: NormalizeStats;
  warnings: string[];
}
