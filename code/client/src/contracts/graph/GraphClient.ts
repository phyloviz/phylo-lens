import type { GraphPrepareRequest } from './prepare/GraphPrepareRequest';
import type { GraphPrepareOptions } from './prepare/GraphPrepareOptions';
import type { GraphPrepareResult } from './prepare/GraphPrepareResult';
import type { GraphAncillaryRequest } from './ancillary/GraphAncillaryRequest';
import type { GraphAncillaryResult } from './ancillary/GraphAncillaryResult';
import type { GraphViewportRequest } from './viewport/GraphViewportRequest';
import type { GraphViewportResult } from './viewport/GraphViewportResult';
import type { GraphRegionRequest } from './region/GraphRegionRequest';
import type { GraphRegionResult } from './region/GraphRegionResult';
import type { GraphSearchRequest } from './search/GraphSearchRequest';
import type { GraphSearchResult } from './search/GraphSearchResult';

export interface GraphClient {
  prepareGraph(request: GraphPrepareRequest, options?: GraphPrepareOptions): Promise<GraphPrepareResult>;

  applyAncillaryData(request: GraphAncillaryRequest): Promise<GraphAncillaryResult>;

  readViewport(request: GraphViewportRequest): Promise<GraphViewportResult>;

  readRegion(request: GraphRegionRequest): Promise<GraphRegionResult>;

  searchGraph(request: GraphSearchRequest): Promise<GraphSearchResult>;
}
