import type { ClusterId, NodeId } from "../graphIdentifiers";
export interface GraphSearchMatch {
  nodeId: NodeId;
  score: number;
  matchedText: string;
  clusterId?: ClusterId | null;
  x?: number | null;
  y?: number | null;
}
