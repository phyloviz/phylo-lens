export const SOURCE_FORMAT_NEWICK = "newick";
export const SOURCE_FORMAT_TYPING_DATA = "typing_data";

export const METADATA_TYPE_STRING = "string";
export const METADATA_TYPE_NUMBER = "number";
export const METADATA_TYPE_BOOLEAN = "boolean";
export const METADATA_TYPE_NULL = "null";

export type SourceFormat =
  | typeof SOURCE_FORMAT_NEWICK
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
  x?: number | null;
  y?: number | null;
  cluster_id?: string | null;
  is_cluster_proxy?: boolean | null;
  is_cluster_skeleton?: boolean | null;
  subtree_size?: number | null;
  leaf_count?: number | null;
}

export interface CanonicalEdge {
  id: string;
  source: string;
  target: string;
  distance?: number | null;
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
  ancillary_rows_by_node_id?: Record<
    string,
    Array<Record<string, string | number | boolean | null>>
  >;
  source: DatasetSource;
}

export interface Viewport {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SearchDatasetMatch {
  node_id: string;
  score: number;
  matched_text: string;
  metadata: Record<string, string | number | boolean | null>;
}

export interface SearchDatasetResponse {
  dataset_id: string;
  query: string;
  matches: SearchDatasetMatch[];
  total_count: number;
}
