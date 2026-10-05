/** Supported Graphviz SFDP overrides for a prepared layout. */
export interface SfdpOptions {
  k?: number;
  repulsiveForce?: number;
  overlap?: "prism" | "scale";
  prismIterations?: number;
  overlapScaling?: number;
  smoothing?: "none" | "avg_dist" | "graph_dist" | "power_dist" | "rng" | "spring" | "triangle";
  quadtree?: "none" | "normal" | "fast";
  beautify?: boolean;
}
