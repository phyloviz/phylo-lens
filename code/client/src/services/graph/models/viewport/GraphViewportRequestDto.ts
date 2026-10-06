export interface GraphViewportRequestDto {
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
