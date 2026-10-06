import type { DatasetId, LayoutVersion } from '../graphIdentifiers';
import { GraphLayoutStatus } from '../graphTypes';
import type { GraphViewportNode } from './GraphViewportNode';
import type { GraphViewportEdge } from './GraphViewportEdge';
import type { GraphLayoutBounds } from './GraphLayoutBounds';
import type { AncillaryField } from '../../ancillary';

export type GraphViewportResult = {
  readonly datasetId: DatasetId;
  readonly layoutVersion: LayoutVersion;
  readonly lodLevel?: number | null;
  readonly zoom: number;
  readonly layoutStatus: GraphLayoutStatus;
  readonly truncated: boolean;
  readonly totalNodeCount: number;
  readonly nodes: readonly GraphViewportNode[];
  readonly edges: readonly GraphViewportEdge[];
  readonly globalBounds?: GraphLayoutBounds | null;
  readonly ancillarySchema?: readonly AncillaryField[];
};
