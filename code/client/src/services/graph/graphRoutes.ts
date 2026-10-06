export const GRAPH_ROUTES = {
  health: '/health',
  prepare: '/api/graph/prepare',
  prepareStatus: (jobId: string) => `/api/graph/prepare/${jobId}`,
  viewport: '/api/graph/viewport',
  region: '/api/graph/region',
  search: '/api/graph/search',
  ancillary: '/api/graph/ancillary',
} as const;
