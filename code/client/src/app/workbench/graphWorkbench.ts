import {
  type DatasetClient,
  type NormalizeRequest,
} from "../../api/datasetClient";
import {
  type CanonicalDataset,
  type SearchDatasetResponse,
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
  serverSpatialBoundsToGraphBounds,
} from "./graphSlice";
import {
  DEFAULT_RENDER_VIEW_SUPPRESSION_MS,
  DEFAULT_VIEWPORT,
  DEFAULT_VIEW_CHANGE_DEBOUNCE_MS,
  DEFAULT_VIEW_SLICE_MAX_NODES,
  DEFAULT_VIEW_SLICE_ZOOM,
  normalizeViewport,
  normalizeZoom,
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
export const SEARCH_FOCUS_LOD_ZOOM = 8;
export const DEFAULT_SEARCH_RESULT_LIMIT = 50;
export const ERR_NO_GRAPH_RENDERED =
  "No graph has been rendered yet. Render a dataset before applying filters.";

const SEARCH_TOKEN_PATTERN = /[A-Za-z0-9_]+/g;
const MIN_SEARCH_PREFIX_LENGTH = 2;

export interface RenderNewickOptions {
  metadataSchema?: CanonicalDataset["metadata_schema"];
  metadataByNodeId?: CanonicalDataset["metadata_by_node_id"];
  ancillaryData?: NormalizeRequest["ancillary_data"];
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

  updateVisualMapping: (visualMapping: VisualMappingOptions) => PositionedGraph;

  searchNodes: (query: {
    query: string;
    limit?: number;
    includeMetadataKeys?: string[];
  }) => Promise<SearchDatasetResponse>;

  focusNode: (nodeId: string) => Promise<PositionedGraph>;

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
  currentSliceDataset: CanonicalDataset | null;
  currentPositionedSliceGraph: PositionedGraph | null;
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

    updateVisualMapping: (visualMapping) =>
      updateVisualMapping({
        state,
        renderer,
        filterEngine,
        visualMapping,
      }),

    searchNodes: (query) =>
      searchNodes({
        state,
        datasetClient: options.datasetClient,
        query,
      }),

    focusNode: (nodeId) =>
      focusNode({
        state,
        renderer,
        datasetClient: options.datasetClient,
        filterEngine,
        nodeId,
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
    currentSliceDataset: null,
    currentPositionedSliceGraph: null,
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
  state.currentSliceDataset = null;
  state.currentPositionedSliceGraph = null;
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

  state.renderMode = "full";
  state.currentSliceDataset = dataset;
  state.currentPositionedSliceGraph = positionedGraph;

  return renderMappedCurrentSlice({
    state,
    renderer,
    filterEngine,
    visualMapping: options.visualMapping,
  });
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

  const request: NormalizeRequest = {
    format: SOURCE_FORMAT_NEWICK,
    dataset_name: datasetName,
    content: newick,
    metadata_schema: options.metadataSchema ?? [],
    metadata_by_node_id: options.metadataByNodeId ?? {},
    ancillary_data: options.ancillaryData,
  };

  const normalized = await datasetClient.normalizeDataset(request);
  const metadataSchema = normalized.dataset.metadata_schema;
  const metadataByNodeId = normalized.dataset.metadata_by_node_id;

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

interface UpdateVisualMappingArgs {
  state: GraphWorkbenchState;
  renderer: GraphRenderer;
  filterEngine: GraphFilterEngine;
  visualMapping: VisualMappingOptions;
}

function updateVisualMapping({
  state,
  renderer,
  filterEngine,
  visualMapping,
}: UpdateVisualMappingArgs): PositionedGraph {
  if (!state.currentSliceDataset || !state.currentPositionedSliceGraph) {
    throw new Error(ERR_NO_GRAPH_RENDERED);
  }

  if (state.preparedSession) {
    state.preparedSession.visualMapping = visualMapping;
  }

  return renderMappedCurrentSlice({
    state,
    renderer,
    filterEngine,
    visualMapping,
  });
}

interface RenderMappedCurrentSliceArgs {
  state: GraphWorkbenchState;
  renderer: GraphRenderer;
  filterEngine: GraphFilterEngine;
  visualMapping?: VisualMappingOptions;
}

function renderMappedCurrentSlice({
  state,
  renderer,
  filterEngine,
  visualMapping,
}: RenderMappedCurrentSliceArgs): PositionedGraph {
  if (!state.currentSliceDataset || !state.currentPositionedSliceGraph) {
    throw new Error(ERR_NO_GRAPH_RENDERED);
  }

  const metadataIndex = buildMetadataIndex(state.currentSliceDataset);
  const mappedGraph = applyVisualMappings(
    state.currentPositionedSliceGraph,
    state.currentSliceDataset,
    metadataIndex,
    visualMapping,
  );

  state.currentSliceGraph = mappedGraph;
  state.currentGraph = hasActiveClientFilters(state.activeFilters)
    ? filterEngine.apply(mappedGraph, metadataIndex, state.activeFilters)
    : mappedGraph;
  state.metadataIndex = metadataIndex;

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

  const effectiveViewport = normalizeViewport(viewState.viewport);
  const effectiveZoom = normalizeZoom(viewState.zoom);
  const effectiveMaxNodes = resolveMaxNodesForZoom(
    session.lod.maxNodes,
    effectiveZoom,
  );

  const nextViewKey = serializeViewKey(
    effectiveViewport,
    effectiveZoom,
    effectiveMaxNodes,
    session.lod.lodHint,
    undefined,
    undefined,
    [...state.expandedClusterIds],
    [...state.collapsedClusterIds],
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
      viewState: {
        viewport: effectiveViewport,
        zoom: effectiveZoom,
      },
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

  toggleClusterExpansion(state, clickedClusterId);

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
      viewport: currentViewState.viewport,
      zoom: currentViewState.zoom,
    },
    options: {
      focusNodeIdOverride: clickState.nodeId,
      focusClusterIdOverride: clickedClusterId,
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
    centerOnNodeId?: string;
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

  const previousSliceGraph =
    state.currentPositionedSliceGraph ?? state.currentSliceGraph;

  const positionedGraph = buildPositionedSliceGraph(
    sliceDataset,
    {
      forceIterations: session.layout?.forceIterations,
    },
    previousSliceGraph,
  );

  state.currentSliceDataset = sliceDataset;
  state.currentPositionedSliceGraph = applySliceViewMeta(
    positionedGraph,
    visibleSlice,
  );

  const renderedGraph = renderMappedCurrentSlice({
    state,
    renderer,
    filterEngine,
    visualMapping: session.visualMapping,
  });

  state.suppressViewChangesUntil =
    Date.now() + DEFAULT_RENDER_VIEW_SUPPRESSION_MS;

  if (
    options.centerOnNodeId &&
    renderedGraph.nodes.some((node) => node.id === options.centerOnNodeId)
  ) {
    renderer.centerOnNode?.(options.centerOnNodeId);
  }

  return renderedGraph;
}

interface SearchNodesArgs {
  state: GraphWorkbenchState;
  datasetClient: DatasetClient;
  query: {
    query: string;
    limit?: number;
    includeMetadataKeys?: string[];
  };
}

async function searchNodes({
  state,
  datasetClient,
  query,
}: SearchNodesArgs): Promise<SearchDatasetResponse> {
  const session = state.preparedSession;

  if (state.renderMode === "full") {
    if (!state.currentSliceDataset) {
      throw new Error(ERR_NO_GRAPH_RENDERED);
    }

    return searchFullRenderedDataset({
      dataset: state.currentSliceDataset,
      query: query.query,
      limit: query.limit ?? DEFAULT_SEARCH_RESULT_LIMIT,
      includeMetadataKeys: query.includeMetadataKeys,
    });
  }

  if (!session || state.renderMode !== "lod") {
    throw new Error(ERR_NO_GRAPH_RENDERED);
  }

  return datasetClient.searchDataset({
    dataset_id: session.datasetId,
    query: query.query,
    limit: query.limit,
    include_metadata_keys:
      query.includeMetadataKeys ?? session.metadataSchema.map((field) => field.key),
  });
}

interface FocusNodeArgs {
  state: GraphWorkbenchState;
  renderer: GraphRenderer;
  datasetClient: DatasetClient;
  filterEngine: GraphFilterEngine;
  nodeId: string;
}

async function focusNode({
  state,
  renderer,
  datasetClient,
  filterEngine,
  nodeId,
}: FocusNodeArgs): Promise<PositionedGraph> {
  const session = state.preparedSession;

  if (state.renderMode === "full") {
    const graph = state.currentGraph ?? state.currentSliceGraph;
    if (!graph) {
      throw new Error(ERR_NO_GRAPH_RENDERED);
    }

    if (graph.nodes.some((node) => node.id === nodeId)) {
      renderer.centerOnNode?.(nodeId);
    }

    return graph;
  }

  if (!session || state.renderMode !== "lod") {
    throw new Error(ERR_NO_GRAPH_RENDERED);
  }

  const currentViewState = state.currentViewState ?? {
    viewport: session.lod.viewport,
    zoom: DEFAULT_VIEW_SLICE_ZOOM,
  };
  const focusZoom = Math.max(currentViewState.zoom, SEARCH_FOCUS_LOD_ZOOM);

  return refreshVisibleSlice({
    state,
    renderer,
    datasetClient,
    filterEngine,
    viewState: {
      viewport: currentViewState.viewport,
      zoom: focusZoom,
    },
    options: {
      focusNodeIdOverride: nodeId,
      centerOnNodeId: nodeId,
    },
  });
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
      globalBounds:
        serverSpatialBoundsToGraphBounds(
          visibleSlice.view_meta.global_bounds,
        ) ?? graph.viewMeta.globalBounds,
    },
  };
}

function searchFullRenderedDataset({
  dataset,
  query,
  limit,
  includeMetadataKeys,
}: {
  dataset: CanonicalDataset;
  query: string;
  limit: number;
  includeMetadataKeys?: string[];
}): SearchDatasetResponse {
  const normalizedQuery = normalizeSearchText(query);
  const queryTokens = tokenizeSearchText(normalizedQuery);
  const scores = new Map<string, number>();

  dataset.nodes.forEach((node) => {
    const normalizedNodeId = normalizeSearchText(node.id);
    if (normalizedNodeId === normalizedQuery) {
      scores.set(node.id, (scores.get(node.id) ?? 0) + 120);
    }
  });

  if (isShortNumericSearchQuery(normalizedQuery)) {
    return buildLocalSearchResponse({
      dataset,
      query,
      scores,
      limit,
      includeMetadataKeys,
    });
  }

  dataset.nodes.forEach((node) => {
    const searchableValues = searchableValuesForNode(dataset, node.id);
    const searchableText = searchableValues.join(" ");
    const normalizedSearchableText = normalizeSearchText(searchableText);

    if (normalizedSearchableText === normalizedQuery) {
      scores.set(node.id, (scores.get(node.id) ?? 0) + 100);
    }

    const searchableTokens = tokenizeSearchText(normalizedSearchableText);
    queryTokens.forEach((queryToken) => {
      searchableTokens.forEach((searchableToken) => {
        if (searchableToken === queryToken) {
          scores.set(node.id, (scores.get(node.id) ?? 0) + 20);
          return;
        }

        if (
          queryToken.length >= MIN_SEARCH_PREFIX_LENGTH &&
          searchableToken.startsWith(queryToken)
        ) {
          scores.set(node.id, (scores.get(node.id) ?? 0) + 8);
        }
      });
    });
  });

  return buildLocalSearchResponse({
    dataset,
    query,
    scores,
    limit,
    includeMetadataKeys,
  });
}

function buildLocalSearchResponse({
  dataset,
  query,
  scores,
  limit,
  includeMetadataKeys,
}: {
  dataset: CanonicalDataset;
  query: string;
  scores: Map<string, number>;
  limit: number;
  includeMetadataKeys?: string[];
}): SearchDatasetResponse {
  const matches = [...scores.entries()]
    .sort(([leftId, leftScore], [rightId, rightScore]) => {
      return rightScore - leftScore || leftId.localeCompare(rightId);
    })
    .map(([nodeId, score]) => ({
      node_id: nodeId,
      score,
      matched_text: searchableValuesForNode(dataset, nodeId).join(" "),
      metadata: selectLocalSearchMetadata(
        dataset.metadata_by_node_id[nodeId] ?? {},
        includeMetadataKeys,
      ),
    }));

  return {
    dataset_id: dataset.dataset_id,
    query,
    matches: matches.slice(0, limit),
    total_count: matches.length,
  };
}

function searchableValuesForNode(
  dataset: CanonicalDataset,
  nodeId: string,
): string[] {
  const metadata = dataset.metadata_by_node_id[nodeId] ?? {};
  return [
    nodeId,
    ...Object.values(metadata)
      .filter((value) => value !== null && value !== undefined)
      .map(String),
  ];
}

function selectLocalSearchMetadata(
  metadata: Record<string, string | number | boolean | null>,
  includeMetadataKeys: string[] | undefined,
): Record<string, string | number | boolean | null> {
  if (!includeMetadataKeys || includeMetadataKeys.length === 0) {
    return {};
  }

  return Object.fromEntries(
    includeMetadataKeys
      .filter((key) => key in metadata)
      .map((key) => [key, metadata[key] as string | number | boolean | null]),
  );
}

function normalizeSearchText(value: string): string {
  return value.toLowerCase().trim();
}

function tokenizeSearchText(value: string): string[] {
  return value.match(SEARCH_TOKEN_PATTERN) ?? [];
}

function isShortNumericSearchQuery(normalizedQuery: string): boolean {
  return normalizedQuery.length <= 1 && /^\d$/.test(normalizedQuery);
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
