import { DatasetClient, NormalizeRequest } from "../api/datasetClient";
import {
  CanonicalDataset,
  SOURCE_FORMAT_NEWICK,
  Viewport,
} from "../contracts/canonical";
import { LAYOUT_DENDROGRAM, PositionedGraph } from "../contracts/positioned";
import { buildMetadataIndex } from "../ancillary/metadataIndex";
import {
  ClientGraphFilterEngine,
  EMPTY_METADATA_FILTER_STATE,
  GraphFilterEngine,
  MetadataFilterState,
} from "../ancillary/filterEngine";
import {
  DEFAULT_LAYER_GAP,
  DEFAULT_NODE_GAP,
  buildSimpleTreeLayout,
  TreeLayoutMode,
} from "../layout/simpleTreeLayout";
import {
  applyVisualMappings,
  VisualMappingOptions,
} from "../render/visualMappings";
import {
  GraphRenderer,
  RenderContext,
  RenderViewportState,
  RendererFactory,
  RendererKind,
} from "../render/types";

export const DEFAULT_DATASET_NAME = "uploaded-dataset";
export const DEFAULT_VIEW_SLICE_ZOOM = 4;
export const DEFAULT_VIEW_SLICE_MAX_NODES = 1500;
export const DEFAULT_VIEW_CHANGE_DEBOUNCE_MS = 180;
export const DEFAULT_VIEWPORT: Viewport = {
  x: 0,
  y: 0,
  width: 1000,
  height: 600,
};
export const ERR_NO_GRAPH_RENDERED =
  "No graph has been rendered yet. Render a dataset before applying filters.";

export interface RenderNewickOptions {
  metadataSchema?: CanonicalDataset["metadata_schema"];
  metadataByNodeId?: CanonicalDataset["metadata_by_node_id"];
  visualMapping?: VisualMappingOptions;
  layout?: {
    mode?: TreeLayoutMode;
    forceIterations?: number;
  };
  lod?: {
    zoom?: number;
    maxNodes?: number;
    lodHint?: number;
    viewport?: Viewport;
  };
}

export interface GraphWorkbenchOptions {
  datasetClient: DatasetClient;
  rendererFactory: RendererFactory;
  rendererKind: RendererKind;
  renderContext: RenderContext;
  filterEngine?: GraphFilterEngine;
}

interface PreparedDatasetSession {
  datasetId: string;
  metadataSchema: CanonicalDataset["metadata_schema"];
  metadataByNodeId: CanonicalDataset["metadata_by_node_id"];
  visualMapping?: VisualMappingOptions;
  layout?: RenderNewickOptions["layout"];
  lod: {
    maxNodes: number;
    lodHint?: number;
    viewport: Viewport;
  };
}

// Orchestrate normalize -> layout -> render through modular client boundaries.
export class GraphWorkbench {
  private readonly datasetClient: DatasetClient;
  private readonly renderer: GraphRenderer;
  private readonly filterEngine: GraphFilterEngine;

  private currentSliceGraph: PositionedGraph | null = null;
  private currentGraph: PositionedGraph | null = null;
  private metadataIndex: ReturnType<typeof buildMetadataIndex> | null = null;
  private activeFilters: MetadataFilterState = EMPTY_METADATA_FILTER_STATE;
  private preparedSession: PreparedDatasetSession | null = null;
  private pendingViewRefreshId: number | null = null;
  private lastRequestedViewKey: string | null = null;
  private sliceRequestSequence = 0;

  constructor(options: GraphWorkbenchOptions) {
    this.datasetClient = options.datasetClient;
    this.filterEngine = options.filterEngine ?? new ClientGraphFilterEngine();
    this.renderer = options.rendererFactory.createRenderer(
      options.rendererKind,
    );
    this.renderer.mount(options.renderContext);
    this.renderer.setViewChangeHandler?.((state) => {
      void this.handleViewChange(state);
    });
  }

  // Prepare a dataset, fetch one visible slice, compute positions, and render it.
  async renderNewick(
    newick: string,
    datasetName = DEFAULT_DATASET_NAME,
    options: RenderNewickOptions = {},
  ): Promise<PositionedGraph> {
    const request: NormalizeRequest = {
      format: SOURCE_FORMAT_NEWICK,
      dataset_name: datasetName,
      content: newick,
      metadata_schema: options.metadataSchema,
      metadata_by_node_id: options.metadataByNodeId,
    };

    const metadataSchema = options.metadataSchema ?? [];
    const metadataByNodeId = options.metadataByNodeId ?? {};

    await this.datasetClient.prepareDataset(request);
    this.preparedSession = {
      datasetId: datasetName,
      metadataSchema,
      metadataByNodeId,
      visualMapping: options.visualMapping,
      layout: options.layout,
      lod: {
        maxNodes: options.lod?.maxNodes ?? DEFAULT_VIEW_SLICE_MAX_NODES,
        lodHint: options.lod?.lodHint,
        viewport: options.lod?.viewport ?? DEFAULT_VIEWPORT,
      },
    };
    this.activeFilters = EMPTY_METADATA_FILTER_STATE;
    this.lastRequestedViewKey = null;

    return this.refreshVisibleSlice({
      viewport: this.preparedSession.lod.viewport,
      zoom: options.lod?.zoom ?? DEFAULT_VIEW_SLICE_ZOOM,
    });
  }

  // Apply metadata filters and re-render the current graph view.
  applyMetadataFilters(filterState: MetadataFilterState): PositionedGraph {
    if (!this.currentSliceGraph || !this.metadataIndex) {
      throw new Error(ERR_NO_GRAPH_RENDERED);
    }

    this.activeFilters = filterState;
    const filteredGraph = this.filterEngine.apply(
      this.currentSliceGraph,
      this.metadataIndex,
      this.activeFilters,
    );
    this.currentGraph = filteredGraph;
    this.renderer.render(filteredGraph);
    return filteredGraph;
  }

  // Clear active metadata filters and restore the complete rendered graph.
  clearMetadataFilters(): PositionedGraph {
    if (!this.currentGraph || !this.metadataIndex) {
      throw new Error(ERR_NO_GRAPH_RENDERED);
    }

    this.activeFilters = EMPTY_METADATA_FILTER_STATE;
    if (!this.currentSliceGraph) {
      throw new Error(ERR_NO_GRAPH_RENDERED);
    }
    this.currentGraph = this.currentSliceGraph;
    this.renderer.render(this.currentSliceGraph);
    return this.currentSliceGraph;
  }

  // Unmount renderer resources when leaving the workbench lifecycle.
  dispose(): void {
    if (this.pendingViewRefreshId !== null) {
      window.clearTimeout(this.pendingViewRefreshId);
      this.pendingViewRefreshId = null;
    }
    this.renderer.setViewChangeHandler?.(null);
    this.renderer.unmount();
  }

  private async handleViewChange(state: RenderViewportState): Promise<void> {
    if (!this.preparedSession) {
      return;
    }

    const nextViewKey = serializeViewKey(
      state.viewport,
      state.zoom,
      this.preparedSession.lod.maxNodes,
      this.preparedSession.lod.lodHint,
    );
    if (nextViewKey === this.lastRequestedViewKey) {
      return;
    }

    if (this.pendingViewRefreshId !== null) {
      window.clearTimeout(this.pendingViewRefreshId);
    }

    this.pendingViewRefreshId = window.setTimeout(() => {
      this.pendingViewRefreshId = null;
      void this.refreshVisibleSlice(state);
    }, DEFAULT_VIEW_CHANGE_DEBOUNCE_MS);
  }

  private async refreshVisibleSlice(state: RenderViewportState): Promise<PositionedGraph> {
    if (!this.preparedSession) {
      throw new Error(ERR_NO_GRAPH_RENDERED);
    }

    const session = this.preparedSession;
    const requestSequence = ++this.sliceRequestSequence;
    const effectiveViewport = normalizeViewport(state.viewport);
    const effectiveZoom = normalizeZoom(state.zoom);
    const focusNodeId = findFocusNodeId(this.currentSliceGraph, effectiveViewport);
    this.lastRequestedViewKey = serializeViewKey(
      effectiveViewport,
      effectiveZoom,
      session.lod.maxNodes,
      session.lod.lodHint,
      focusNodeId,
    );

    const visibleSlice = await this.datasetClient.viewSlice({
      dataset_id: session.datasetId,
      viewport: effectiveViewport,
      zoom: effectiveZoom,
      lod_hint: session.lod.lodHint,
      max_nodes: session.lod.maxNodes,
      focus_node_id: focusNodeId,
      include_metadata_keys: session.metadataSchema.map((field) => field.key),
    });

    if (requestSequence !== this.sliceRequestSequence) {
      return this.currentGraph ?? this.currentSliceGraph ?? emptyGraph();
    }

    const sliceDataset = buildSliceDataset(
      session.datasetId,
      visibleSlice.nodes,
      visibleSlice.edges,
      session.metadataSchema,
      session.metadataByNodeId,
    );

    const positionedGraph = buildPositionedSliceGraph(sliceDataset, {
      mode: session.layout?.mode,
      forceIterations: session.layout?.forceIterations,
    });
    const metadataIndex = buildMetadataIndex(sliceDataset);
    const mappedGraph = applyVisualMappings(
      positionedGraph,
      sliceDataset,
      metadataIndex,
      session.visualMapping,
    );
    const graphWithSliceMeta: PositionedGraph = {
      ...mappedGraph,
      viewMeta: {
        ...mappedGraph.viewMeta,
        lodLevel: visibleSlice.lod_level,
        sliceNodeCount: visibleSlice.view_meta.returned_node_count,
        sliceEdgeCount: visibleSlice.view_meta.returned_edge_count,
        collapsedClusterCount: visibleSlice.collapsed_clusters.length,
        zoom: visibleSlice.view_meta.zoom,
      },
    };

    this.currentSliceGraph = graphWithSliceMeta;
    this.metadataIndex = metadataIndex;
    this.currentGraph = hasActiveClientFilters(this.activeFilters)
      ? this.filterEngine.apply(
          graphWithSliceMeta,
          metadataIndex,
          this.activeFilters,
        )
      : graphWithSliceMeta;

    this.renderer.render(this.currentGraph);
    return this.currentGraph;
  }
}

function buildSliceDataset(
  datasetId: string,
  nodes: CanonicalDataset["nodes"],
  edges: CanonicalDataset["edges"],
  metadataSchema: CanonicalDataset["metadata_schema"],
  metadataByNodeId: CanonicalDataset["metadata_by_node_id"],
): CanonicalDataset {
  const visibleNodeIdSet = new Set(nodes.map((node) => node.id));
  const visibleMetadataByNodeId = Object.fromEntries(
    Object.entries(metadataByNodeId).filter(([nodeId]) =>
      visibleNodeIdSet.has(nodeId),
    ),
  );

  return {
    dataset_id: datasetId,
    nodes,
    edges,
    metadata_schema: metadataSchema,
    metadata_by_node_id: visibleMetadataByNodeId,
    source: {
      format: SOURCE_FORMAT_NEWICK,
      generated_at: new Date(0).toISOString(),
    },
  };
}

function buildPositionedSliceGraph(
  dataset: CanonicalDataset,
  options: RenderNewickOptions["layout"] = {},
): PositionedGraph {
  if (dataset.nodes.every(hasServerCoordinates)) {
    return {
      nodes: dataset.nodes.map((node) => ({
        id: node.id,
        x: (node.x as number) * DEFAULT_NODE_GAP,
        y: (node.y as number) * DEFAULT_LAYER_GAP,
      })),
      edges: dataset.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
      })),
      viewMeta: {
        layout: LAYOUT_DENDROGRAM,
        lodLevel: 0,
      },
    };
  }

  return buildSimpleTreeLayout(dataset, {
    mode: options.mode,
    forceIterations: options.forceIterations,
  });
}

function serializeViewKey(
  viewport: Viewport,
  zoom: number,
  maxNodes: number,
  lodHint?: number,
  focusNodeId?: string,
): string {
  return JSON.stringify({
    viewport,
    zoom,
    maxNodes,
    lodHint,
    focusNodeId,
  });
}

function normalizeViewport(viewport: Viewport): Viewport {
  return {
    x: viewport.x,
    y: viewport.y,
    width: viewport.width > 0 ? viewport.width : DEFAULT_VIEWPORT.width,
    height: viewport.height > 0 ? viewport.height : DEFAULT_VIEWPORT.height,
  };
}

function normalizeZoom(zoom: number): number {
  if (!Number.isFinite(zoom) || zoom < 0) {
    return DEFAULT_VIEW_SLICE_ZOOM;
  }
  return zoom;
}

function hasActiveClientFilters(filterState: MetadataFilterState): boolean {
  return (
    filterState.categorical.some((filter) => filter.acceptedValues.length > 0) ||
    filterState.numeric.some(
      (filter) => filter.min !== undefined || filter.max !== undefined,
    )
  );
}

function emptyGraph(): PositionedGraph {
  return {
    nodes: [],
    edges: [],
    viewMeta: {
      layout: "force",
      lodLevel: 0,
      sliceNodeCount: 0,
      sliceEdgeCount: 0,
      collapsedClusterCount: 0,
    },
  };
}

function hasServerCoordinates(node: CanonicalDataset["nodes"][number]): boolean {
  return (
    typeof node.x === "number" &&
    Number.isFinite(node.x) &&
    typeof node.y === "number" &&
    Number.isFinite(node.y)
  );
}

function findFocusNodeId(
  graph: PositionedGraph | null,
  viewport: Viewport,
): string | undefined {
  if (!graph || graph.nodes.length === 0) {
    return undefined;
  }

  const centerX = viewport.x;
  const centerY = viewport.y;
  let bestNodeId = graph.nodes[0]?.id;
  let bestDistance = Number.POSITIVE_INFINITY;

  graph.nodes.forEach((node) => {
    const dx = node.x - centerX;
    const dy = node.y - centerY;
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      bestDistance = distance;
      bestNodeId = node.id;
    }
  });

  return bestNodeId;
}
