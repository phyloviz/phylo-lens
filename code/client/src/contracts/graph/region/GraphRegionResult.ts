import type { DatasetId, LayoutVersion } from '../graphIdentifiers';
import { GraphLayoutStatus } from '../graphTypes';
import type { GraphViewportNode } from '../viewport/GraphViewportNode';
import type { GraphViewportEdge } from '../viewport/GraphViewportEdge';
import type { AncillaryField, AncillaryData } from '../../ancillary';

export type GraphRegionResult = {
    readonly datasetId: DatasetId;
    readonly layoutVersion: LayoutVersion;
    readonly layoutStatus: GraphLayoutStatus;
    readonly truncated: boolean;
    readonly totalNodeCount: number;
    readonly nodes: readonly GraphViewportNode[];
    readonly edges: readonly GraphViewportEdge[];
    readonly ancillarySchema?: readonly AncillaryField[];
    readonly aggregatedAncillaryData: AncillaryData;
};
