import type { GraphClient } from "../../api/graphClient";
import type { GraphMetadataField, GraphMetadataValue } from "../../api/graphContracts";
import type { CanonicalDataset, SearchDatasetResponse, SourceFormat, Viewport } from "../../contracts/models";
import type { PositionedGraph } from "../../contracts/positioned";
import type { MetadataIndexData } from "../../ancillary/metadataIndex";
import type { MetadataFilterState } from "../../ancillary/metadataTypes";
import type { VisualMappingOptions } from "../../render/mapping/visualMapping";
import type {
  GraphDisplayOptions,
  RenderNodeClickState,
  RenderContext,
  RenderViewportBounds,
  RendererFactory,
  RendererKind,
} from "../../render/renderer.types";

// Public workbench contracts.

// The isolated subgraph plus aggregated metadata for a completed region (box)
// selection. Node ids feed the canvas highlight; aggregated metadata feeds the
// region stats panel.
export interface RegionSelectionResult {
  nodeIds: string[];
  nodeCount: number;
  truncated: boolean;
  aggregatedMetadata: Record<string, GraphMetadataValue>;
  metadataSchema: GraphMetadataField[];
}

export type RegionSelectedHandler = (bounds: RenderViewportBounds) => void;

export interface RenderNewickOptions {
  // Source family of `content`: "newick" parses the text directly; "typing_data"
  // routes an allelic-profile matrix through the server's PhyloLib tree build.
  // Defaults to "newick" when unset so existing callers are unaffected.
  sourceFormat?: SourceFormat;
  metadataSchema?: CanonicalDataset["metadata_schema"];
  metadataByNodeId?: CanonicalDataset["metadata_by_node_id"];
  ancillaryData?: {
    format: "auto" | "csv" | "tsv";
    content: string;
    join_column: string;
  };
  visualMapping?: VisualMappingOptions;
  // Seed presentation toggles with the render request. This keeps the first
  // viewport snapshot consistent with selections made before loading a graph.
  displayOptions?: GraphDisplayOptions;
  layout?: {
    forceIterations?: number;
  };
  lod?: {
    maxNodes?: number;
    lodHint?: number;
    viewport?: Viewport;
  };
}

export interface GraphWorkbenchOptions {
  graphClient: GraphClient;
  rendererFactory: RendererFactory;
  rendererKind: RendererKind;
  renderContext: RenderContext;
}

export type GraphRenderedHandler = (graph: PositionedGraph) => void;
export type GraphNodeClickedHandler = (state: RenderNodeClickState) => void;

export interface GraphWorkbench {
  renderNewick: (newick: string, datasetName?: string, options?: RenderNewickOptions) => Promise<PositionedGraph>;

  exportPng: () => Promise<Blob>;

  applyMetadataFilters: (filterState: MetadataFilterState) => PositionedGraph;

  clearMetadataFilters: () => PositionedGraph;

  updateVisualMapping: (visualMapping: VisualMappingOptions) => PositionedGraph;

  updateDisplayOptions: (displayOptions: GraphDisplayOptions) => void;

  setLodRefreshPaused: (paused: boolean) => Promise<PositionedGraph | null>;

  isLodRefreshPaused: () => boolean;

  searchNodes: (query: { query: string; limit?: number }) => Promise<SearchDatasetResponse>;

  focusNode: (
    nodeId: string,
    coordinates?: { x: number | null; y: number | null; clusterId?: string | null },
  ) => Promise<PositionedGraph>;

  setGraphRenderedHandler: (handler: GraphRenderedHandler | null) => void;

  setNodeClickedHandler: (handler: GraphNodeClickedHandler | null) => void;

  // Toggle canvas box-select mode on the renderer.
  setRegionSelectModeEnabled: (enabled: boolean) => void;

  // Read the isolated subgraph + aggregated metadata for a box-select region
  // and highlight the selected nodes on the canvas.
  selectRegion: (bounds: RenderViewportBounds) => Promise<RegionSelectionResult>;

  // Register a handler that fires when the user completes a box-select drag.
  setRegionSelectedHandler: (handler: RegionSelectedHandler | null) => void;

  // Clear any active region highlight (empty set repaints at full opacity).
  clearRegionSelection: () => void;

  dispose: () => void;
}

// Internal workbench state.

export interface PreparedDatasetSession {
  datasetId: string;
  layoutVersion?: string;
  metadataSchema: CanonicalDataset["metadata_schema"];
  metadataByNodeId: CanonicalDataset["metadata_by_node_id"];
  ancillaryRowsByNodeId: CanonicalDataset["ancillary_rows_by_node_id"];
  visualMapping?: VisualMappingOptions;
  // Presentation toggles applied during viewport sync (node labels, edge
  // distance labels, distance-weighted edge thickness).
  displayOptions?: GraphDisplayOptions;
  // Prepare-time warnings, surfaced by the shell on every slice.
  layoutWarnings?: string[];
  layout?: RenderNewickOptions["layout"];
  // Total precomputed LoD tiers for the dataset (from the prepare response).
  // Surfaced in the status bar as "LoD tier X/Y" so semantic-zoom transitions
  // are observable.
  lodTierCount?: number;
  lod: {
    maxNodes: number;
    lodHint?: number;
    viewport: Viewport;
  };
}

export interface GraphWorkbenchState {
  currentSliceDataset: CanonicalDataset | null;
  currentGraph: PositionedGraph | null;
  metadataIndex: MetadataIndexData | null;
  metadataIndexSignature: string | null;
  activeFilters: MetadataFilterState;
  preparedSession: PreparedDatasetSession | null;
  pendingViewRefreshId: number | null;
  lodRefreshPaused: boolean;
  graphRenderedHandler: GraphRenderedHandler | null;
  nodeClickedHandler: GraphNodeClickedHandler | null;
  // Node currently focused via search. Forwarded to the LoD sync so it is
  // highlighted (red) on every viewport re-fetch, including the slice pulled in
  // by focusing a node that was outside the current view.
  focusedNodeId: string | null;
}
