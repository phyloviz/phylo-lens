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

export interface PositionedGraphBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface PositionedGraph {
  nodes: PositionedNode[];
  edges: PositionedEdge[];
  viewMeta: {
    layout: LayoutMode;
    lodLevel: number;
    // Total number of precomputed LoD tiers for the dataset. Together with
    // lodLevel this lets the shell show "LoD tier X/Y" so a semantic-zoom tier
    // change is observable (the coarse tier no longer looks distinct once
    // single-member proxies render as plain leaves).
    lodTierCount?: number;
    sliceNodeCount?: number;
    sliceEdgeCount?: number;
    zoom?: number;
    globalBounds?: PositionedGraphBounds;
    // Server layout status for the current slice. "degraded" means the force
    // layout fell back to a topology-ignoring circular scatter; the shell
    // surfaces this so a distorted-looking first tier is explained rather than
    // mistaken for a real topology change.
    layoutStatus?: string;
    // Human-readable warnings from the prepare step (e.g. the degrade reason).
    layoutWarnings?: string[];
  };
}
