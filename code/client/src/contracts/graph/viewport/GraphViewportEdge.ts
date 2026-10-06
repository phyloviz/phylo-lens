import type { NodeId } from '../graphIdentifiers';
export type GraphViewportEdge = {
  readonly id: string;
  readonly source: NodeId;
  readonly target: NodeId;
  readonly distance?: number | null;
  readonly isMeta?: boolean | null;
};
