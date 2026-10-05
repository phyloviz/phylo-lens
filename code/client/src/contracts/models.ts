export const SOURCE_FORMAT_NEWICK = "newick";
export const SOURCE_FORMAT_TYPING_DATA = "typing_data";

export const METADATA_TYPE_STRING = "string";
export const METADATA_TYPE_NUMBER = "number";
export const METADATA_TYPE_BOOLEAN = "boolean";
export const METADATA_TYPE_NULL = "null";

export type SourceFormat = typeof SOURCE_FORMAT_NEWICK | typeof SOURCE_FORMAT_TYPING_DATA;

export type { AncillaryField, AncillaryType } from "./ancillary";
import type { AncillaryField, AncillaryData, NodeAnnotations, Isolate } from "./ancillary";

export interface CanonicalNode {
  id: string;
  x?: number | null;
  y?: number | null;
  clusterId?: string | null;
  isClusterProxy?: boolean | null;
  isClusterSkeleton?: boolean | null;
  subtreeSize?: number | null;
  leafCount?: number | null;
}

export interface CanonicalEdge {
  id: string;
  source: string;
  target: string;
  distance?: number | null;
}

export interface DatasetSource {
  format: SourceFormat;
  generatedAt: string;
  provenance?: string;
}

export interface CanonicalDataset {
  datasetId: string;
  nodes: CanonicalNode[];
  edges: CanonicalEdge[];
  ancillarySchema: AncillaryField[];
  annotationsByNodeId: Record<string, NodeAnnotations>;
  isolatesByNodeId?: Record<string, Isolate[]>;
  ancillaryRowsByNodeId?: Record<string, AncillaryData[]>;
  source: DatasetSource;
}

export interface Viewport {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SearchDatasetMatch {
  nodeId: string;
  score: number;
  matchedText: string;
  metadata: Record<string, string | number | boolean | null>;
  clusterId?: string | null;
  // Global layout coordinates of the matched node (null when unavailable),
  // used to center/highlight a hit outside the current LoD slice.
  x?: number | null;
  y?: number | null;
}

export interface SearchDatasetResponse {
  datasetId: string;
  query: string;
  matches: SearchDatasetMatch[];
  totalCount: number;
}
