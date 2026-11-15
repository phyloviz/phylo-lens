import type { GraphClient } from '../../contracts/graph/GraphClient';
import { createHttpClient, type HttpClientOptions } from '../httpClient';
import { prepareGraph } from './prepare/prepareService';
import { applyAncillaryData } from './ancillary/ancillaryService';
import { readGraphViewport } from './viewport/viewportService';
import { readGraphRegion } from './region/regionService';
import { searchGraph } from './search/searchService';

import { readGraphComponents } from './graphComponentsService';
import { readDistanceConnections } from './graphConnectionsService';
import { setTechnicalRoot } from './rooting/rootingService';

export function createGraphClient(options: HttpClientOptions): Required<GraphClient> {
  const http = createHttpClient(options);

  return {
    setTechnicalRoot: request => setTechnicalRoot(http, request),
    readDistanceConnections: (request, options) => readDistanceConnections(http, request, options),
    readComponents: request => readGraphComponents(http, request),
    prepareGraph: (request, options) => prepareGraph(http, request, options),
    applyAncillaryData: request => applyAncillaryData(http, request),
    readViewport: (request, options) => readGraphViewport(http, request, options),
    readRegion: request => readGraphRegion(http, request),
    searchGraph: request => searchGraph(http, request),
  };
}
