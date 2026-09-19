import type { DragSelection, PngExportOptions } from "../../render/renderer.types";
import type { ExpansionResult, ExpansionState } from "../../contracts/expansion";
import type { AncillaryData, AncillaryField } from "../../contracts/ancillary";
import type { AncillaryInputOptions } from "../../ancillary/ancillaryInput";
import type { GraphClient } from "../../api/graphClient";
import type {
  GraphAncillaryResponse,
  GraphAncillaryField,
  GraphAncillaryValue,
  SfdpOptions,
} from "../../api/graphContracts";
import type { CanonicalDataset, SearchDatasetResponse, SourceFormat, Viewport } from "../../contracts/models";
import type { PositionedGraph } from "../../contracts/positioned";
import type { AncillaryIndex } from "../../ancillary/ancillaryIndex";
import type { AncillaryFilterState } from "../../ancillary/ancillaryTypes";
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
  scope?: "display";
  nodeIds: string[];
  nodeCount: number;
  truncated: boolean;
  aggregatedMetadata: Record<string, GraphAncillaryValue>;
  metadataSchema: GraphAncillaryField[];
}

export type RegionSelectedHandler = (bounds: RenderViewportBounds) => void;

export interface RenderNewickOptions extends AncillaryInputOptions {
  // Source family of `content`: "newick" parses the text directly; "typing_data"
  // routes an allelic-profile matrix through the server's PhyloLib tree build.
  // Defaults to "newick" when unset so existing callers are unaffected.
  sourceFormat?: SourceFormat;
  visualMapping?: VisualMappingOptions;
  // Seed presentation toggles with the render request. This keeps the first
  // viewport snapshot consistent with selections made before loading a graph.
  displayOptions?: GraphDisplayOptions;
  // Optional SFDP overrides are sent with preparation. Omitted fields defer to
  // Graphviz's defaults.
  sfdpOptions?: SfdpOptions;
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
  expandCluster: (clusterId: string) => Promise<ExpansionResult>;
  collapseCluster: (clusterId: string) => ExpansionState;
  expandAll: () => Promise<ExpansionResult>;
  collapseAll: () => Promise<ExpansionResult>;
  setKeepExpanded: (keep: boolean) => ExpansionState;
  getExpansionState: () => ExpansionState;

  renderNewick: (newick: string, datasetName?: string, options?: RenderNewickOptions) => Promise<PositionedGraph>;

  applyAncillaryData: (data: NonNullable<RenderNewickOptions["ancillaryData"]>) => Promise<GraphAncillaryResponse>;

  setMotionEnabled: (enabled: boolean) => void;
  isMotionEnabled: () => boolean;
  setInteractionFeedbackHandler: (handler: ((message: string) => void) | null) => void;
  setDragSelection: (selection: DragSelection) => void;
  resetLayoutEdits: () => void;
  exportPng: (options?: PngExportOptions) => Promise<Blob>;

  applyMetadataFilters: (filterState: AncillaryFilterState) => PositionedGraph;

  clearMetadataFilters: () => PositionedGraph;

  updateVisualMapping: (visualMapping: VisualMappingOptions) => PositionedGraph;

  updateDisplayOptions: (displayOptions: GraphDisplayOptions) => void;

  setLodRefreshPaused: (paused: boolean) => Promise<PositionedGraph | null>;

  isLodRefreshPaused: () => boolean;

  searchNodes: (query: { query: string; limit?: number }) => Promise<SearchDatasetResponse>;

  cancelPendingFocus: () => void;
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
  ancillarySchema: AncillaryField[];
  ancillaryByNodeId: Record<string, AncillaryData>;
  ancillaryRowsByNodeId: CanonicalDataset["ancillary_rows_by_node_id"];
  visualMapping?: VisualMappingOptions;
  // Presentation toggles applied during viewport sync (node labels, edge
  // distance labels, distance-weighted edge thickness).
  displayOptions?: GraphDisplayOptions;
  // Prepare-time warnings, surfaced by the shell on every slice.
  layoutWarnings?: string[];
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
  ancillaryIndex: AncillaryIndex | null;
  ancillaryIndexSignature: string | null;
  activeFilters: AncillaryFilterState;
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
