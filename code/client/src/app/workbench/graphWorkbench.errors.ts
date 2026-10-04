export const ERR_NO_GRAPH_RENDERED = "No graph has been rendered yet. Render a dataset before applying filters.";
export const ERR_LOD_PLAYBACK_REQUIRES_LOD = "LoD play/pause controls are available after rendering a LoD dataset.";
export const ERR_GRAPH_VIEWPORT_SYNC_REQUIRED = "Graph viewport sync is required for LoD rendering.";
export const ERR_GRAPH_LOAD_SUPERSEDED = "Graph load was superseded by a newer load.";
export const ERR_GRAPH_PNG_EXPORT_UNAVAILABLE = "PNG export is unavailable for this renderer.";

export const GRAPH_WORKBENCH_ERRORS = {
  loadSuperseded: "Graph load was superseded by a newer load.",
  pngExportUnavailable: "PNG export is unavailable for this renderer.",
  noGraphRendered: "No graph has been rendered.",
  viewportRequired: "Graph viewport synchronization is required.",
  lodPlaybackRequiresLodDataset: "LoD play/pause controls are available after rendering a LoD dataset.",
} as const;
