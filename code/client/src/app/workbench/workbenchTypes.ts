import type { GraphV2Client } from "../../api/graphV2Client";
import type {
  CanonicalDataset,
  SearchDatasetResponse,
  Viewport,
} from "../../contracts/models";
import type { PositionedGraph } from "../../contracts/positioned";
import type { MetadataIndexData } from "../../ancillary/metadataIndex";
import type {
  GraphFilterEngine,
  MetadataFilterState,
} from "../../ancillary/filterEngine";
import type { VisualMappingOptions } from "../../render/visualMappings";
import type {
  GraphDisplayOptions,
  RenderNodeClickState,
  RenderContext,
  RenderViewportState,
  RendererFactory,
  RendererKind,
} from "../../render/types";

export interface RenderNewickOptions {
  metadataSchema?: CanonicalDataset["metadata_schema"];
  metadataByNodeId?: CanonicalDataset["metadata_by_node_id"];
  ancillaryData?: {
    format: "auto" | "csv" | "tsv";
    content: string;
    join_column?: string;
  };
  visualMapping?: VisualMappingOptions;
  layout?: {
    forceIterations?: number;
  };
  lod?: {
    enabled?: boolean;
    fullRenderNodeLimit?: number;
    zoom?: number;
    maxNodes?: number;
    lodHint?: number;
    viewport?: Viewport;
  };
}

export interface GraphWorkbenchOptions {
  graphV2Client: GraphV2Client;
  rendererFactory: RendererFactory;
  rendererKind: RendererKind;
  renderContext: RenderContext;
  filterEngine?: GraphFilterEngine;
}

export type GraphRenderedHandler = (graph: PositionedGraph) => void;
export type GraphNodeClickedHandler = (state: RenderNodeClickState) => void;

export interface GraphWorkbench {
  renderNewick: (
    newick: string,
    datasetName?: string,
    options?: RenderNewickOptions,
  ) => Promise<PositionedGraph>;

  applyMetadataFilters: (filterState: MetadataFilterState) => PositionedGraph;

  clearMetadataFilters: () => PositionedGraph;

  updateVisualMapping: (visualMapping: VisualMappingOptions) => PositionedGraph;

  updateDisplayOptions: (displayOptions: GraphDisplayOptions) => void;

  setLodRefreshPaused: (paused: boolean) => Promise<PositionedGraph | null>;

  isLodRefreshPaused: () => boolean;

  searchNodes: (query: {
    query: string;
    limit?: number;
    includeMetadataKeys?: string[];
  }) => Promise<SearchDatasetResponse>;

  focusNode: (nodeId: string) => Promise<PositionedGraph>;

  setGraphRenderedHandler: (handler: GraphRenderedHandler | null) => void;

  setNodeClickedHandler: (handler: GraphNodeClickedHandler | null) => void;

  dispose: () => void;
}

export interface PreparedDatasetSession {
  datasetId: string;
  layoutVersion?: string;
  metadataSchema: CanonicalDataset["metadata_schema"];
  metadataByNodeId: CanonicalDataset["metadata_by_node_id"];
  ancillaryRowsByNodeId: CanonicalDataset["ancillary_rows_by_node_id"];
  visualMapping?: VisualMappingOptions;
  layout?: RenderNewickOptions["layout"];
  lod: {
    maxNodes: number;
    lodHint?: number;
    viewport: Viewport;
  };
}

export type RenderMode = "full" | "lod";

export interface GraphWorkbenchState {
  currentSliceDataset: CanonicalDataset | null;
  currentPositionedSliceGraph: PositionedGraph | null;
  currentSliceGraph: PositionedGraph | null;
  currentGraph: PositionedGraph | null;
  metadataIndex: MetadataIndexData | null;
  activeFilters: MetadataFilterState;
  preparedSession: PreparedDatasetSession | null;
  pendingViewRefreshId: number | null;
  lastRequestedViewKey: string | null;
  sliceRequestSequence: number;
  currentViewState: RenderViewportState | null;
  deferredViewState: RenderViewportState | null;
  lodRefreshPaused: boolean;
  graphRenderedHandler: GraphRenderedHandler | null;
  nodeClickedHandler: GraphNodeClickedHandler | null;
  suppressViewChangesUntil: number;
  renderMode: RenderMode | null;
}
