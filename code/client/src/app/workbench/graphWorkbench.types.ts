import type { DragSelection, PngExportOptions } from "../../render/renderer.types";
import type { ExpansionResult, ExpansionState } from "../../contracts/expansion";
import type { AncillaryData, AncillaryField, AncillaryTableInput } from "../../contracts/ancillary";
import type {
  GraphAncillaryResponse,
  GraphAncillaryField,
  GraphAncillaryValue,
  SfdpOptions,
  GraphClient,
} from "../../api/graphContracts";
import type { CanonicalDataset, SearchDatasetResponse, SourceFormat, Viewport } from "../../contracts/models";
import type { PositionedGraph } from "../../contracts/positioned";
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
import type { AncillaryInputOptions } from "../../ancillary/ancillaryInput";

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

export interface GraphInput {
  readonly content: string;
  readonly format: SourceFormat;
  readonly datasetName?: string;
}

export interface LoadGraphOptions extends AncillaryInputOptions {
  readonly visualMapping?: VisualMappingOptions;
  readonly displayOptions?: GraphDisplayOptions;
  readonly sfdpOptions?: SfdpOptions;

  readonly lod?: {
    readonly maxNodes?: number;
    readonly representationSpacingPx?: number;
    readonly smallTreeThreshold?: number;
    readonly lodHint?: number;
    readonly viewport?: Viewport;
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

  loadGraph: (input: GraphInput, options?: LoadGraphOptions) => Promise<PositionedGraph>;

  applyAncillaryData: (data: AncillaryTableInput) => Promise<GraphAncillaryResponse>;

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

export interface GraphSession {
  readonly datasetId: string;
  readonly layoutVersion: string;
  readonly ancillarySchema: readonly AncillaryField[];
  readonly ancillaryByNodeId: Readonly<Record<string, AncillaryData>>;
  readonly ancillaryRowsByNodeId: CanonicalDataset["ancillary_rows_by_node_id"];
  readonly visualMapping?: VisualMappingOptions;
  readonly displayOptions?: GraphDisplayOptions;
  readonly layoutWarnings?: readonly string[];
  readonly lodTierCount?: number;

  readonly lod: {
    readonly maxNodes?: number;
    readonly representationSpacingPx?: number;
    readonly smallTreeThreshold?: number;
    readonly lodHint?: number;
    readonly viewport: Viewport;
  };
}

export interface GraphWorkbenchState {
  readonly graphSession: GraphSession | null;
  readonly graphSnapshot: PositionedGraph | null;
  readonly focusedNodeId: string | null;
  readonly activeFilters: AncillaryFilterState;
  readonly lodRefreshPaused: boolean;
}
