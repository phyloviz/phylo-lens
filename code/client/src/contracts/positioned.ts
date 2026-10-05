import type { GraphLayoutBounds } from "./graph/viewport/GraphLayoutBounds";
export const LAYOUT_FORCE = "force";
export const LAYOUT_RADIAL = "radial";
export const LAYOUT_DENDROGRAM = "dendrogram";
export const LAYOUT_SERVER = "server";

export type LayoutMode = typeof LAYOUT_FORCE | typeof LAYOUT_RADIAL | typeof LAYOUT_DENDROGRAM | typeof LAYOUT_SERVER;

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
    lodTierCount?: number;
    sliceNodeCount?: number;
    sliceEdgeCount?: number;
    zoom?: number;
    globalBounds?: GraphLayoutBounds;
    layoutStatus?: string;
    layoutWarnings?: readonly string[];
  };
}
