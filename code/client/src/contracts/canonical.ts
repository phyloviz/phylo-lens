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
  x?: number;
  y?: number;
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

export interface Viewport {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface VisibleSliceQuery {
  dataset_id: string;
  viewport: Viewport;
  zoom: number;
  lod_hint?: number;
  max_nodes?: number;
  focus_node_id?: string;
  include_metadata_keys?: string[];
  filters?: {
    categorical?: Record<string, string[]>;
    numeric?: Record<string, { min?: number; max?: number }>;
  };
}

export interface CollapsedCluster {
  cluster_id: string;
  representative_node_id?: string;
  subtree_size: number;
  centroid?: Record<string, number>;
}

export interface VisibleSliceViewMeta {
  viewport: Viewport;
  zoom: number;
  returned_node_count: number;
  returned_edge_count: number;
}

export interface VisibleSliceResponse {
  dataset_id: string;
  lod_level: number;
  nodes: CanonicalNode[];
  edges: CanonicalEdge[];
  collapsed_clusters: CollapsedCluster[];
  view_meta: VisibleSliceViewMeta;
}

export interface PrepareDatasetStats extends NormalizeStats {
  hierarchy_ms: number;
  store_ms: number;
}

export interface PrepareDatasetResponse {
  dataset_id: string;
  stats: PrepareDatasetStats;
  warnings: string[];
}
