export const LAYOUT_FORCE = "force";
export const LAYOUT_RADIAL = "radial";
export const LAYOUT_DENDROGRAM = "dendrogram";

export type LayoutMode =
  | typeof LAYOUT_FORCE
  | typeof LAYOUT_RADIAL
  | typeof LAYOUT_DENDROGRAM;

export interface PositionedNode {
  id: string;
  x: number;
  y: number;
  size?: number;
  color?: string;
  attributes?: Record<string, unknown>;
}

export interface PositionedEdge {
  id: string;
  source: string;
  target: string;
  attributes?: Record<string, unknown>;
}

export interface PositionedGraph {
  nodes: PositionedNode[];
  edges: PositionedEdge[];
  viewMeta: {
    layout: LayoutMode;
    lodLevel: number;
  };
}
