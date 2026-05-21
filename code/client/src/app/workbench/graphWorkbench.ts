import {
  type DatasetClient,
  type NormalizeRequest,
} from "../../api/datasetClient";
import {
  type CanonicalDataset,
  SOURCE_FORMAT_NEWICK,
  type Viewport,
} from "../../contracts/models";
import { type PositionedGraph } from "../../contracts/positioned";
import { buildMetadataIndex } from "../../ancillary/metadataIndex";
import {
  ClientGraphFilterEngine,
  EMPTY_METADATA_FILTER_STATE,
  type GraphFilterEngine,
  type MetadataFilterState,
} from "../../ancillary/filterEngine";
import {
  applyVisualMappings,
  type VisualMappingOptions,
} from "../../render/visualMappings";
import type {
  GraphRenderer,
  RenderContext,
  RenderNodeClickState,
  RenderViewportState,
  RendererFactory,
  RendererKind,
} from "../../render/types";
import {
  buildFullPositionedGraph,
  buildPositionedSliceGraph,
  buildSliceDataset,
  emptyGraph,
} from "./graphSlice";
import {
  DEFAULT_RENDER_VIEW_SUPPRESSION_MS,
  DEFAULT_VIEWPORT,
  DEFAULT_VIEW_CHANGE_DEBOUNCE_MS,
  DEFAULT_VIEW_SLICE_MAX_NODES,
  DEFAULT_VIEW_SLICE_ZOOM,
  normalizeViewport,
  normalizeZoom,
  recenterViewportOnNode,
  resolveMaxNodesForZoom,
  serializeViewKey,
} from "./graphViewport";

export {
  DEFAULT_RENDER_VIEW_SUPPRESSION_MS,
  DEFAULT_VIEWPORT,
  DEFAULT_VIEW_CHANGE_DEBOUNCE_MS,
  DEFAULT_VIEW_SLICE_MAX_NODES,
  DEFAULT_VIEW_SLICE_ZOOM,
  MAX_DYNAMIC_VIEW_SLICE_NODES,
} from "./graphViewport";

export const DEFAULT_DATASET_NAME = "uploaded-dataset";
export const DEFAULT_FULL_RENDER_NODE_LIMIT = 4000;
export const ERR_NO_GRAPH_RENDERED =
  "No graph has been rendered yet. Render a dataset before applying filters.";

export interface RenderNewickOptions {
  metadataSchema?: CanonicalDataset["metadata_schema"];
  metadataByNodeId?: CanonicalDataset["metadata_by_node_id"];
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
  datasetClient: DatasetClient;
  rendererFactory: RendererFactory;
  rendererKind: RendererKind;
  renderContext: RenderContext;
  filterEngine?: GraphFilterEngine;
}

export type GraphRenderedHandler = (graph: PositionedGraph) => void;

export interface GraphWorkbench {
  renderNewick: (
    newick: string,
    datasetName?: string,
    options?: RenderNewickOptions,
  ) => Promise<PositionedGraph>;

  applyMetadataFilters: (filterState: MetadataFilterState) => PositionedGraph;

  clearMetadataFilters: () => PositionedGraph;

  setGraphRenderedHandler: (handler: GraphRenderedHandler | null) => void;

  dispose: () => void;
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

type RenderMode = "full" | "lod";
interface GraphWorkbenchState {
  currentSliceGraph: PositionedGraph | null;
  currentGraph: PositionedGraph | null;
  metadataIndex: ReturnType<typeof buildMetadataIndex> | null;
  activeFilters: MetadataFilterState;
  preparedSession: PreparedDatasetSession | null;
  pendingViewRefreshId: number | null;
  lastRequestedViewKey: string | null;
  sliceRequestSequence: number;
  currentViewState: RenderViewportState | null;
  graphRenderedHandler: GraphRenderedHandler | null;
  suppressViewChangesUntil: number;
  expandedClusterIds: Set<string>;
  collapsedClusterIds: Set<string>;
  renderMode: RenderMode | null;
}

export function createGraphWorkbench(
  options: GraphWorkbenchOptions,
): GraphWorkbench {
  const state = createInitialGraphWorkbenchState();
  const filterEngine = options.filterEngine ?? new ClientGraphFilterEngine();

  const renderer = createMountedRenderer(options);

  renderer.setViewChangeHandler?.((viewState) => {
    void handleViewChange({
      state,
      renderer,
      datasetClient: options.datasetClient,
      filterEngine,
      viewState,
    });
  });

  renderer.setNodeClickHandler?.((clickState) => {
    void handleNodeClick({
      state,
      renderer,
      datasetClient: options.datasetClient,
      filterEngine,
      clickState,
    });
  });

  return {
    renderNewick: (newick, datasetName, renderOptions) =>
      renderNewick({
        state,
        renderer,
        datasetClient: options.datasetClient,
        filterEngine,
        newick,
        datasetName,
        options: renderOptions,
      }),

    applyMetadataFilters: (filterState) =>
      applyMetadataFilters({
        state,
        renderer,
        filterEngine,
        filterState,
      }),

    clearMetadataFilters: () =>
      clearMetadataFilters({
        state,
        renderer,
      }),

    setGraphRenderedHandler: (handler) => {
      state.graphRenderedHandler = handler;
    },

    dispose: () => {
      disposeGraphWorkbench(state, renderer);
    },
  };
}

function createInitialGraphWorkbenchState(): GraphWorkbenchState {
  return {
    currentSliceGraph: null,
    currentGraph: null,
    metadataIndex: null,
    activeFilters: EMPTY_METADATA_FILTER_STATE,
    preparedSession: null,
    pendingViewRefreshId: null,
    lastRequestedViewKey: null,
    sliceRequestSequence: 0,
    currentViewState: null,
    graphRenderedHandler: null,
    suppressViewChangesUntil: 0,
    expandedClusterIds: new Set(),
    collapsedClusterIds: new Set(),
    renderMode: null,
  };
}

function createMountedRenderer(options: GraphWorkbenchOptions): GraphRenderer {
  const renderer = options.rendererFactory.createRenderer(options.rendererKind);

  renderer.mount(options.renderContext);

  return renderer;
}

function shouldUseLodMode(
  dataset: CanonicalDataset,
  options: RenderNewickOptions,
): boolean {
  if (options.lod?.enabled !== undefined) {
    return options.lod.enabled;
  }

  const fullRenderLimit =
    options.lod?.fullRenderNodeLimit ?? DEFAULT_FULL_RENDER_NODE_LIMIT;

  return dataset.nodes.length > fullRenderLimit;
}

function resetWorkbenchForNewDataset(state: GraphWorkbenchState): void {
  state.currentSliceGraph = null;
  state.currentGraph = null;
  state.metadataIndex = null;
  state.activeFilters = EMPTY_METADATA_FILTER_STATE;
  state.preparedSession = null;
  state.pendingViewRefreshId = null;
  state.lastRequestedViewKey = null;
  state.currentViewState = null;
  state.expandedClusterIds.clear();
  state.collapsedClusterIds.clear();
  state.renderMode = null;
}

interface RenderFullDatasetArgs {
  state: GraphWorkbenchState;
  renderer: GraphRenderer;
  filterEngine: GraphFilterEngine;
  dataset: CanonicalDataset;
  options: RenderNewickOptions;
}

function renderFullDataset({
  state,
  renderer,
  filterEngine,
  dataset,
  options,
}: RenderFullDatasetArgs): PositionedGraph {
  const positionedGraph = buildFullPositionedGraph(dataset, options.layout);
  const metadataIndex = buildMetadataIndex(dataset);

  const mappedGraph = applyVisualMappings(
    positionedGraph,
    dataset,
    metadataIndex,
    options.visualMapping,
  );

  state.renderMode = "full";
  state.currentSliceGraph = mappedGraph;
  state.currentGraph = hasActiveClientFilters(state.activeFilters)
    ? filterEngine.apply(mappedGraph, metadataIndex, state.activeFilters)
    : mappedGraph;
  state.metadataIndex = metadataIndex;

  renderer.render(state.currentGraph);
  emitGraphRendered(state, state.currentGraph);

  return state.currentGraph;
}

interface RenderNewickArgs {
  state: GraphWorkbenchState;
  renderer: GraphRenderer;
  datasetClient: DatasetClient;
  filterEngine: GraphFilterEngine;
  newick: string;
  datasetName?: string;
  options?: RenderNewickOptions;
}

async function renderNewick({
  state,
  renderer,
  datasetClient,
  filterEngine,
  newick,
  datasetName = DEFAULT_DATASET_NAME,
  options = {},
}: RenderNewickArgs): Promise<PositionedGraph> {
  resetWorkbenchForNewDataset(state);

  const metadataSchema = options.metadataSchema ?? [];
  const metadataByNodeId = options.metadataByNodeId ?? {};

  const request: NormalizeRequest = {
    format: SOURCE_FORMAT_NEWICK,
    dataset_name: datasetName,
    content: newick,
    metadata_schema: metadataSchema,
    metadata_by_node_id: metadataByNodeId,
  };

  const normalized = await datasetClient.normalizeDataset(request);

  if (!shouldUseLodMode(normalized.dataset, options)) {
    return renderFullDataset({
      state,
      renderer,
      filterEngine,
      dataset: normalized.dataset,
      options,
    });
  }

  const preparedDataset = await datasetClient.prepareDataset(request);

  state.renderMode = "lod";
  state.preparedSession = {
    datasetId: preparedDataset.dataset_id,
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

  return refreshVisibleSlice({
    state,
    renderer,
    datasetClient,
    filterEngine,
    viewState: {
      viewport: state.preparedSession.lod.viewport,
      zoom: options.lod?.zoom ?? DEFAULT_VIEW_SLICE_ZOOM,
    },
  });
}

interface ApplyMetadataFiltersArgs {
  state: GraphWorkbenchState;
  renderer: GraphRenderer;
  filterEngine: GraphFilterEngine;
  filterState: MetadataFilterState;
}

function applyMetadataFilters({
  state,
  renderer,
  filterEngine,
  filterState,
}: ApplyMetadataFiltersArgs): PositionedGraph {
  if (!state.currentSliceGraph || !state.metadataIndex) {
    throw new Error(ERR_NO_GRAPH_RENDERED);
  }

  state.activeFilters = filterState;

  state.currentGraph = filterEngine.apply(
    state.currentSliceGraph,
    state.metadataIndex,
    state.activeFilters,
  );

  renderer.render(state.currentGraph);
  emitGraphRendered(state, state.currentGraph);

  return state.currentGraph;
}

interface ClearMetadataFiltersArgs {
  state: GraphWorkbenchState;
  renderer: GraphRenderer;
}

function clearMetadataFilters({
  state,
  renderer,
}: ClearMetadataFiltersArgs): PositionedGraph {
  if (!state.currentSliceGraph || !state.metadataIndex) {
    throw new Error(ERR_NO_GRAPH_RENDERED);
  }

  state.activeFilters = EMPTY_METADATA_FILTER_STATE;
  state.currentGraph = state.currentSliceGraph;

  renderer.render(state.currentGraph);
  emitGraphRendered(state, state.currentGraph);

  return state.currentGraph;
}

interface HandleViewChangeArgs {
  state: GraphWorkbenchState;
  renderer: GraphRenderer;
  datasetClient: DatasetClient;
  filterEngine: GraphFilterEngine;
  viewState: RenderViewportState;
}

async function handleViewChange({
  state,
  renderer,
  datasetClient,
  filterEngine,
  viewState,
}: HandleViewChangeArgs): Promise<void> {
  const session = state.preparedSession;

  if (!session || state.renderMode !== "lod") {
    return;
  }

  if (Date.now() < state.suppressViewChangesUntil) {
    return;
  }

  const nextViewKey = serializeViewKey(
    viewState.viewport,
    viewState.zoom,
    session.lod.maxNodes,
    session.lod.lodHint,
  );

  if (nextViewKey === state.lastRequestedViewKey) {
    return;
  }

  clearPendingViewRefresh(state);

  state.pendingViewRefreshId = window.setTimeout(() => {
    state.pendingViewRefreshId = null;

    void refreshVisibleSlice({
      state,
      renderer,
      datasetClient,
      filterEngine,
      viewState,
    });
  }, DEFAULT_VIEW_CHANGE_DEBOUNCE_MS);
}

interface HandleNodeClickArgs {
  state: GraphWorkbenchState;
  renderer: GraphRenderer;
  datasetClient: DatasetClient;
  filterEngine: GraphFilterEngine;
  clickState: RenderNodeClickState;
}

async function handleNodeClick({
  state,
  renderer,
  datasetClient,
  filterEngine,
  clickState,
}: HandleNodeClickArgs): Promise<void> {
  const session = state.preparedSession;

  if (!session || state.renderMode !== "lod") {
    return;
  }

  const clickedNode = state.currentGraph?.nodes.find(
    (node) => node.id === clickState.nodeId,
  );

  const clickedClusterId = getClickedClusterId(clickState, clickedNode);

  if (!clickedClusterId || !isClusterProxyClick(clickState, clickedNode)) {
    return;
  }

  const expansionAction = toggleClusterExpansion(state, clickedClusterId);

  const currentViewState = state.currentViewState ?? {
    viewport: session.lod.viewport,
    zoom: DEFAULT_VIEW_SLICE_ZOOM,
  };

  await refreshVisibleSlice({
    state,
    renderer,
    datasetClient,
    filterEngine,
    viewState: {
      viewport:
        expansionAction === "expanded"
          ? recenterViewportOnNode(currentViewState.viewport, clickedNode)
          : currentViewState.viewport,
      zoom: currentViewState.zoom,
    },
    options: {
      focusNodeIdOverride: clickState.nodeId,
      focusClusterIdOverride: clickedClusterId,
      centerOnFocusNode: expansionAction === "expanded",
    },
  });
}

function toggleClusterExpansion(
  state: GraphWorkbenchState,
  clusterId: string,
): "expanded" | "collapsed" {
  if (state.expandedClusterIds.has(clusterId)) {
    state.expandedClusterIds.delete(clusterId);
    state.collapsedClusterIds.add(clusterId);
    return "collapsed";
  }

  state.collapsedClusterIds.delete(clusterId);
  state.expandedClusterIds.add(clusterId);
  return "expanded";
}

interface RefreshVisibleSliceArgs {
  state: GraphWorkbenchState;
  renderer: GraphRenderer;
  datasetClient: DatasetClient;
  filterEngine: GraphFilterEngine;
  viewState: RenderViewportState;
  options?: {
    focusNodeIdOverride?: string;
    focusClusterIdOverride?: string;
    centerOnFocusNode?: boolean;
  };
}

async function refreshVisibleSlice({
  state,
  renderer,
  datasetClient,
  filterEngine,
  viewState,
  options = {},
}: RefreshVisibleSliceArgs): Promise<PositionedGraph> {
  const session = state.preparedSession;

  if (!session) {
    throw new Error(ERR_NO_GRAPH_RENDERED);
  }

  const requestSequence = ++state.sliceRequestSequence;
  const effectiveViewport = normalizeViewport(viewState.viewport);
  const effectiveZoom = normalizeZoom(viewState.zoom);
  const focusNodeId = options.focusNodeIdOverride;
  const focusClusterId = options.focusClusterIdOverride;

  state.currentViewState = {
    viewport: effectiveViewport,
    zoom: effectiveZoom,
  };

  const effectiveMaxNodes = resolveMaxNodesForZoom(
    session.lod.maxNodes,
    effectiveZoom,
  );

  state.lastRequestedViewKey = serializeViewKey(
    effectiveViewport,
    effectiveZoom,
    effectiveMaxNodes,
    session.lod.lodHint,
    focusNodeId,
    focusClusterId,
    [...state.expandedClusterIds],
    [...state.collapsedClusterIds],
  );

  const visibleSlice = await datasetClient.viewSlice({
    dataset_id: session.datasetId,
    viewport: effectiveViewport,
    zoom: effectiveZoom,
    lod_hint: session.lod.lodHint,
    max_nodes: effectiveMaxNodes,
    focus_node_id: focusNodeId,
    focus_cluster_id: focusClusterId,
    expanded_cluster_ids: [...state.expandedClusterIds],
    collapsed_cluster_ids: [...state.collapsedClusterIds],
    include_metadata_keys: session.metadataSchema.map((field) => field.key),
  });

  if (requestSequence !== state.sliceRequestSequence) {
    return state.currentGraph ?? state.currentSliceGraph ?? emptyGraph();
  }

  const sliceDataset = buildSliceDataset(
    session.datasetId,
    visibleSlice.nodes,
    visibleSlice.edges,
    session.metadataSchema,
    session.metadataByNodeId,
  );

  const previousSliceGraph = state.currentSliceGraph;

  const positionedGraph = buildPositionedSliceGraph(
    sliceDataset,
    {
      forceIterations: session.layout?.forceIterations,
    },
    previousSliceGraph,
  );

  const metadataIndex = buildMetadataIndex(sliceDataset);

  const mappedGraph = applyVisualMappings(
    positionedGraph,
    sliceDataset,
    metadataIndex,
    session.visualMapping,
  );

  const graphWithSliceMeta = applySliceViewMeta(mappedGraph, visibleSlice);

  state.currentSliceGraph = graphWithSliceMeta;
  state.metadataIndex = metadataIndex;
  state.currentGraph = hasActiveClientFilters(state.activeFilters)
    ? filterEngine.apply(graphWithSliceMeta, metadataIndex, state.activeFilters)
    : graphWithSliceMeta;

  renderer.render(state.currentGraph);

  state.suppressViewChangesUntil =
    Date.now() + DEFAULT_RENDER_VIEW_SUPPRESSION_MS;

  if (options.centerOnFocusNode && options.focusNodeIdOverride) {
    renderer.centerOnNode?.(options.focusNodeIdOverride);
  }

  emitGraphRendered(state, state.currentGraph);

  return state.currentGraph;
}

function applySliceViewMeta(
  graph: PositionedGraph,
  visibleSlice: Awaited<ReturnType<DatasetClient["viewSlice"]>>,
): PositionedGraph {
  return {
    ...graph,
    viewMeta: {
      ...graph.viewMeta,
      lodLevel: visibleSlice.lod_level,
      sliceNodeCount: visibleSlice.view_meta.returned_node_count,
      sliceEdgeCount: visibleSlice.view_meta.returned_edge_count,
      collapsedClusterCount: visibleSlice.collapsed_clusters.length,
      zoom: visibleSlice.view_meta.zoom,
      globalBounds: visibleSlice.view_meta.global_bounds
        ? {
            minX: visibleSlice.view_meta.global_bounds.min_x,
            maxX: visibleSlice.view_meta.global_bounds.max_x,
            minY: visibleSlice.view_meta.global_bounds.min_y,
            maxY: visibleSlice.view_meta.global_bounds.max_y,
          }
        : graph.viewMeta.globalBounds,
    },
  };
}

function hasActiveClientFilters(filterState: MetadataFilterState): boolean {
  return (
    filterState.categorical.some(
      (filter) => filter.acceptedValues.length > 0,
    ) ||
    filterState.numeric.some(
      (filter) => filter.min !== undefined || filter.max !== undefined,
    )
  );
}

function isClusterProxyClick(
  clickState: RenderNodeClickState,
  clickedNode: PositionedGraph["nodes"][number] | undefined,
): boolean {
  return (
    clickState.attributes?.is_cluster_proxy === true ||
    clickedNode?.attributes?.is_cluster_proxy === true
  );
}

function clearPendingViewRefresh(state: GraphWorkbenchState): void {
  if (state.pendingViewRefreshId === null) {
    return;
  }

  window.clearTimeout(state.pendingViewRefreshId);
  state.pendingViewRefreshId = null;
}

function disposeGraphWorkbench(
  state: GraphWorkbenchState,
  renderer: GraphRenderer,
): void {
  clearPendingViewRefresh(state);
  renderer.setViewChangeHandler?.(null);
  renderer.setNodeClickHandler?.(null);
  renderer.unmount();
}

function emitGraphRendered(
  state: GraphWorkbenchState,
  graph: PositionedGraph,
): void {
  state.graphRenderedHandler?.(graph);
}

function getClickedClusterId(
  clickState: RenderNodeClickState,
  clickedNode: PositionedGraph["nodes"][number] | undefined,
): string | undefined {
  const fromClickState = clickState.attributes?.cluster_id;
  const fromGraphNode = clickedNode?.attributes?.cluster_id;

  if (typeof fromClickState === "string") {
    return fromClickState;
  }

  if (typeof fromGraphNode === "string") {
    return fromGraphNode;
  }

  return undefined;
}
