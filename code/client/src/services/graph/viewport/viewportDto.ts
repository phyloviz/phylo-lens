import type { AncillaryData, AncillaryObservation, AncillaryField } from '../../../contracts/ancillary';
import type { GraphLayoutStatus } from '../../../contracts/graph/graphTypes';

export interface GraphIsolateDto {
  id: string;
  metadata: AncillaryData;
  metadata_cached?: boolean;
}

export interface GraphLayoutBoundsDto {
  min_x: number;
  max_x: number;
  min_y: number;
  max_y: number;
}

export interface GraphViewportEdgeDto {
  id: string;
  source: string;
  target: string;
  distance?: number | null;
  is_meta?: boolean | null;
}

export interface GraphViewportNodeDto {
  annotations_cached?: boolean;
  id: string;
  cluster_id: string;
  x: number;
  y: number;
  layout_status: GraphLayoutStatus;
  member_count: number;
  is_representative: boolean;
  tree_index?: {
    component_id: string;
    parent_id?: string | null;
    depth: number;
    start: number;
    end: number;
  } | null;
  metadata?: AncillaryData | null;
  isolates?: GraphIsolateDto[];
  ancillary_distribution?: AncillaryObservationDto[];
}

export type AncillaryObservationDto = Omit<AncillaryObservation, 'referenceId'> & {
  readonly reference_id?: string;
  readonly values_cached?: boolean;
};

export interface GraphViewportRequestDto {
  known_observations?: readonly string[];
  known_annotations?: readonly {
    readonly node_id: string;
    readonly cluster_id: string;
    readonly is_representative: boolean;
  }[];
  component_id?: string;
  dataset_id: string;
  layout_version?: string | null;
  cluster_id?: string | null;
  focus_node_id?: string | null;
  xmin?: number;
  xmax?: number;
  ymin?: number;
  ymax?: number;
  zoom?: number;
  lod_level?: number | null;
  max_nodes?: number | null;
  /** Adaptive selection ceiling is lod_level; counts never limit retrieval. */
  lod_target_representations?: number;
  lod_selection_bounds?: { xmin: number; xmax: number; ymin: number; ymax: number };
  previous_lod_level?: number | null;
}

export interface GraphViewportResponseDto {
  dataset_id: string;
  layout_version: string;
  lod_level?: number | null;
  zoom: number;
  layout_status: GraphLayoutStatus;
  truncated: boolean;
  total_node_count: number;
  nodes: GraphViewportNodeDto[];
  edges: GraphViewportEdgeDto[];
  global_bounds?: GraphLayoutBoundsDto | null;
  metadata_schema?: AncillaryField[];
}
