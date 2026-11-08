import type { GraphPrepareRequest } from './prepare/GraphPrepareRequest';
import type { GraphPrepareOptions } from './prepare/GraphPrepareOptions';
import type { GraphPrepareResult } from './prepare/GraphPrepareResult';
import type { GraphAncillaryRequest } from './ancillary/GraphAncillaryRequest';
import type { GraphAncillaryResult } from './ancillary/GraphAncillaryResult';
import type { GraphViewportRequest } from './viewport/GraphViewportRequest';
import type { GraphViewportResult } from './viewport/GraphViewportResult';
import type { GraphViewportReadOptions } from './viewport/GraphViewportReadOptions';
import type { GraphRegionRequest } from './region/GraphRegionRequest';
import type { GraphRegionResult } from './region/GraphRegionResult';
import type { GraphSearchRequest } from './search/GraphSearchRequest';
import type { GraphSearchResult } from './search/GraphSearchResult';

import type { GraphComponentsRequest, GraphComponentsResult } from './components';

export interface GraphClient {
  readComponents?(request: GraphComponentsRequest): Promise<GraphComponentsResult>;
  prepareGraph(request: GraphPrepareRequest, options?: GraphPrepareOptions): Promise<GraphPrepareResult>;

  applyAncillaryData(request: GraphAncillaryRequest): Promise<GraphAncillaryResult>;

  readViewport(request: GraphViewportRequest, options?: GraphViewportReadOptions): Promise<GraphViewportResult>;

  readRegion(request: GraphRegionRequest): Promise<GraphRegionResult>;

  searchGraph(request: GraphSearchRequest): Promise<GraphSearchResult>;
}
