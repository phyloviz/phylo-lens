import type { GraphClient } from '../../contracts/graph/GraphClient';
import { createHttpClient, type HttpClientOptions } from '../httpClient';
import { prepareGraph } from './graphPrepareService';
import { applyAncillaryData } from './graphAncillaryService';
import { readGraphViewport } from './graphViewportService';
import { readGraphRegion } from './graphRegionService';
import { searchGraph } from './graphSearchService';

import { readGraphComponents } from './graphComponentsService';
import { readDistanceConnections } from './graphConnectionsService';

export function createGraphClient(options: HttpClientOptions): GraphClient {
  const http = createHttpClient(options);

  return {
    readDistanceConnections: (request, options) => readDistanceConnections(http, request, options),
    readComponents: request => readGraphComponents(http, request),
    prepareGraph: (request, options) => prepareGraph(http, request, options),
    applyAncillaryData: request => applyAncillaryData(http, request),
    readViewport: (request, options) => readGraphViewport(http, request, options),
    readRegion: request => readGraphRegion(http, request),
    searchGraph: request => searchGraph(http, request),
  };
}
