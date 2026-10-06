/** Supported Graphviz SFDP overrides for a prepared layout. */
export type SfdpOptions = {
  readonly k?: number;
  readonly repulsiveForce?: number;
  readonly overlap?: 'prism' | 'scale';
  readonly prismIterations?: number;
  readonly overlapScaling?: number;
  readonly smoothing?: 'none' | 'avg_dist' | 'graph_dist' | 'power_dist' | 'rng' | 'spring' | 'triangle';
  readonly quadtree?: 'none' | 'normal' | 'fast';
  readonly beautify?: boolean;
};
