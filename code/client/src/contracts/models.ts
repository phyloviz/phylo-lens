export const SOURCE_FORMAT_NEWICK = "newick";
export const SOURCE_FORMAT_TYPING_DATA = "typing_data";

export const METADATA_TYPE_STRING = "string";
export const METADATA_TYPE_NUMBER = "number";
export const METADATA_TYPE_BOOLEAN = "boolean";
export const METADATA_TYPE_NULL = "null";

export type SourceFormat = typeof SOURCE_FORMAT_NEWICK | typeof SOURCE_FORMAT_TYPING_DATA;

export type { AncillaryField, AncillaryType } from "./ancillary";
import type { AncillaryField, AncillaryData, NodeAnnotations, Isolate } from "./ancillary";
/** @deprecated Use AncillaryField. */
export type MetadataField = AncillaryField;
/** @deprecated Use AncillaryType. */
export type MetadataType = import("./ancillary").AncillaryType;

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

/** API v1 / persisted flat representation. Decode before using domain data. */
export interface LegacyCanonicalDataset {
  isolates_by_node_id?: Record<
    string,
    Array<{ id: string; metadata: Record<string, string | number | boolean | null> }>
  >;
  dataset_id: string;
  nodes: CanonicalNode[];
  edges: CanonicalEdge[];
  metadata_schema: AncillaryField[];
  metadata_by_node_id: Record<string, Record<string, string | number | boolean | null>>;
  ancillary_rows_by_node_id?: Record<string, Array<Record<string, string | number | boolean | null>>>;
  source: DatasetSource;
}

export interface CanonicalDataset {
  dataset_id: string;
  nodes: CanonicalNode[];
  edges: CanonicalEdge[];
  ancillarySchema: AncillaryField[];
  annotationsByNodeId: Record<string, NodeAnnotations>;
  isolatesByNodeId?: Record<string, Isolate[]>;
  ancillary_rows_by_node_id?: Record<string, AncillaryData[]>;
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
  cluster_id?: string | null;
  // Global layout coordinates of the matched node (null when unavailable),
  // used to center/highlight a hit outside the current LoD slice.
  x?: number | null;
  y?: number | null;
}

export interface SearchDatasetResponse {
  dataset_id: string;
  query: string;
  matches: SearchDatasetMatch[];
  total_count: number;
}
