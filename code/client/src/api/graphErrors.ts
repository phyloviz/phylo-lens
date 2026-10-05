export const GRAPH_API_ERRORS = {
  invalidPrepareResponse: "Invalid graph prepare response contract.",

  invalidPrepareJob: "Invalid graph prepare job contract.",

  invalidPrepareStatus: "Invalid graph prepare status contract.",

  prepareFailed: "Graph layout preparation failed.",

  prepareTimedOut: "Graph layout preparation did not complete in time.",

  invalidViewportResponse: "Invalid graph viewport response contract.",

  invalidRegionResponse: "Invalid graph region response contract.",

  invalidSearchResponse: "Invalid graph search response contract.",

  invalidPrepareRequest: "Invalid graph prepare request contract.",

  invalidAncillaryResponse: "Invalid graph ancillary response contract.",
} as const;
