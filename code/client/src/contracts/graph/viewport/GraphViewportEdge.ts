import type { NodeId } from "../graphIdentifiers";
export interface GraphViewportEdge {
  id: string;
  source: NodeId;
  target: NodeId;
  distance?: number | null;
  isMeta?: boolean | null;
}
