export interface GraphViewportEdge {
  id: string;
  source: string;
  target: string;
  distance?: number | null;
  isMeta?: boolean | null;
}
