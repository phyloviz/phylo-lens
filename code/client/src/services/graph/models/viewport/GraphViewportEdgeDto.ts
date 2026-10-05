export interface GraphViewportEdgeDto {
  id: string;
  source: string;
  target: string;
  distance?: number | null;
  is_meta?: boolean | null;
}
