import type { DatasetId, LayoutVersion } from '../graphIdentifiers';
import { GraphLayoutStatus } from '../graphTypes';
import type { GraphViewportNode } from '../viewport/GraphViewportNode';
import type { GraphViewportEdge } from '../viewport/GraphViewportEdge';
import type { AncillaryField, AncillaryData } from '../../ancillary';

export interface GraphRegionResult {
    datasetId: DatasetId;
    layoutVersion: LayoutVersion;
    layoutStatus: GraphLayoutStatus;
    truncated: boolean;
    totalNodeCount: number;
    nodes: GraphViewportNode[];
    edges: GraphViewportEdge[];
    ancillarySchema?: AncillaryField[];
    aggregatedAncillaryData: AncillaryData;
}
