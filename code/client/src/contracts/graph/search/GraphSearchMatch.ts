export interface GraphSearchMatch {
  nodeId: string;
  score: number;
  matchedText: string;
  clusterId?: string | null;
  x?: number | null;
  y?: number | null;
}
