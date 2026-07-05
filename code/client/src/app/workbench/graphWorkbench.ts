import type {
  GraphV2Client,
  GraphV2ViewportResponse,
  NormalizeRequest,
} from "../../api/graphV2Client";
import {
  type CanonicalDataset,
  type SearchDatasetResponse,
  SOURCE_FORMAT_NEWICK,
} from "../../contracts/models";
import { type PositionedGraph } from "../../contracts/positioned";
import { buildMetadataIndex } from "../../ancillary/metadataIndex";
import {
  buildPieAttributes,
  isCategoryCountMetadataKey,
} from "../../render/pieMapping";
import type {
  GraphRenderer,
  RenderNodeClickState,
} from "../../render/types";
import { emptyGraph } from "./graphSlice";
import {
  DEFAULT_VIEWPORT,
  DEFAULT_VIEW_SLICE_MAX_NODES,
} from "./graphViewport";
import {
  applyMetadataFilters,
  clearMetadataFilters,
  updateVisualMapping,
} from "./rendering/graphFilters";
import type { SigmaViewportBounds } from "../../render/adapters/sigma/graphViewerV2Types";
import type {
  GraphWorkbench,
  GraphWorkbenchOptions,
  GraphWorkbenchState,
  RegionSelectionResult,
  RenderNewickOptions,
} from "./workbenchTypes";
import {
  ERR_LOD_PLAYBACK_REQUIRES_LOD,
  ERR_NO_GRAPH_RENDERED,
} from "./workbenchErrors";
import { searchDatasetNodes } from "./nodeSearch";
import {
  clearPendingViewRefresh,
  createInitialGraphWorkbenchState,
  resetWorkbenchForNewDataset,
} from "./workbenchState";

export {
  DEFAULT_RENDER_VIEW_SUPPRESSION_MS,
  DEFAULT_VIEWPORT,
  DEFAULT_VIEW_CHANGE_DEBOUNCE_MS,
  DEFAULT_VIEW_SLICE_MAX_NODES,
  DEFAULT_VIEW_SLICE_ZOOM,
  MAX_DYNAMIC_VIEW_SLICE_NODES,
} from "./graphViewport";
export type {
  GraphNodeClickedHandler,
  GraphRenderedHandler,
  GraphWorkbench,
  GraphWorkbenchOptions,
  RenderNewickOptions,
} from "./workbenchTypes";

export const DEFAULT_DATASET_NAME = "uploaded-dataset";
export const DEFAULT_SEARCH_RESULT_LIMIT = 50;
export const GRAPH_V2_DETAIL_LOD_LEVEL = 3;
export { ERR_LOD_PLAYBACK_REQUIRES_LOD, ERR_NO_GRAPH_RENDERED };

export function createGraphWorkbench(
  options: GraphWorkbenchOptions,
): GraphWorkbench {
  const state = createInitialGraphWorkbenchState();

  const renderer = options.rendererFactory.createRenderer(options.rendererKind);
  renderer.mount(options.renderContext);

  renderer.setViewChangeHandler?.(() => {
    void handleViewChange({
      state,
    });
  });

  renderer.setNodeClickHandler?.((clickState) => {
    void handleNodeClick({
      state,
      clickState,
    });
  });

  return {
    renderNewick: (newick, datasetName, renderOptions) =>
      renderNewick({
        state,
        renderer,
        graphV2Client: options.graphV2Client,
        newick,
        datasetName,
        options: renderOptions,
      }),

    applyMetadataFilters: (filterState) =>
      applyMetadataFilters({
        state,
        renderer,
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
        visualMapping,
      }),

    updateDisplayOptions: (displayOptions) => {
      renderer.updateDisplayOptions?.(displayOptions);
      if (state.currentGraph) {
        renderer.render(state.currentGraph);
      }
    },

    setLodRefreshPaused: (paused) =>
      setLodRefreshPaused({
        state,
        renderer,
        paused,
      }),

    isLodRefreshPaused: () => state.lodRefreshPaused,

    searchNodes: (query) =>
      searchNodes({
        state,
        query,
      }),

    focusNode: (nodeId) =>
      focusNode({
        state,
        renderer,
        nodeId,
      }),

    setGraphRenderedHandler: (handler) => {
      state.graphRenderedHandler = handler;
    },

    setNodeClickedHandler: (handler) => {
      state.nodeClickedHandler = handler;
    },

    setRegionSelectModeEnabled: (enabled) => {
      renderer.setRegionSelectModeEnabled?.(enabled);
    },

    selectRegion: (bounds) =>
      selectRegion({
        state,
        renderer,
        graphV2Client: options.graphV2Client,
        bounds,
      }),

    setRegionSelectedHandler: (handler) => {
      renderer.setRegionSelectedHandler?.(handler);
    },

    clearRegionSelection: () => {
      renderer.setHighlightedNodes?.(null);
    },

    dispose: () => {
      disposeGraphWorkbench(state, renderer);
    },
  };
}

interface SelectRegionArgs {
  state: GraphWorkbenchState;
  renderer: GraphRenderer;
  graphV2Client: GraphV2Client;
  bounds: SigmaViewportBounds;
}

async function selectRegion({
  state,
  renderer,
  graphV2Client,
  bounds,
}: SelectRegionArgs): Promise<RegionSelectionResult> {
  const session = state.preparedSession;

  if (!session || state.renderMode !== "lod") {
    throw new Error(ERR_NO_GRAPH_RENDERED);
  }

  const response = await graphV2Client.readRegion({
    dataset_id: session.datasetId,
    layout_version: session.layoutVersion ?? null,
    xmin: bounds.xmin,
    xmax: bounds.xmax,
    ymin: bounds.ymin,
    ymax: bounds.ymax,
  });

  const nodeIds = response.nodes.map((node) => node.id);
  renderer.setHighlightedNodes?.(new Set(nodeIds));

  return {
    nodeIds,
    nodeCount: response.total_node_count,
    truncated: response.truncated,
    aggregatedMetadata: response.aggregated_metadata,
    metadataSchema: response.metadata_schema ?? [],
  };
}

interface RenderNewickArgs {
  state: GraphWorkbenchState;
  renderer: GraphRenderer;
  graphV2Client: GraphV2Client;
  newick: string;
  datasetName?: string;
  options?: RenderNewickOptions;
}

async function renderNewick({
  state,
  renderer,
  graphV2Client,
  newick,
  datasetName = DEFAULT_DATASET_NAME,
  options = {},
}: RenderNewickArgs): Promise<PositionedGraph> {
  resetWorkbenchForNewDataset(state);
  renderer.focusNode?.(null);

  const request: NormalizeRequest = {
    format: SOURCE_FORMAT_NEWICK,
    dataset_name: datasetName,
    content: newick,
    metadata_schema: options.metadataSchema ?? [],
    metadata_by_node_id: options.metadataByNodeId ?? {},
    ancillary_data: options.ancillaryData,
  };

  if (renderer.startGraphV2ViewportSync) {
    const preparedGraph = await graphV2Client.prepareGraph(request);

    state.renderMode = "lod";
    state.preparedSession = {
      datasetId: preparedGraph.dataset_id,
      layoutVersion: preparedGraph.layout_version,
      metadataSchema: options.metadataSchema ?? [],
      metadataByNodeId: options.metadataByNodeId ?? {},
      ancillaryRowsByNodeId: {},
      visualMapping: options.visualMapping,
      layout: options.layout,
      lod: {
        maxNodes: options.lod?.maxNodes ?? DEFAULT_VIEW_SLICE_MAX_NODES,
        lodHint: options.lod?.lodHint,
        viewport: options.lod?.viewport ?? DEFAULT_VIEWPORT,
      },
    };
    state.currentSliceDataset = null;

    renderer.startGraphV2ViewportSync({
      client: graphV2Client,
      datasetId: preparedGraph.dataset_id,
      layoutVersion: preparedGraph.layout_version,
      maxNodes: state.preparedSession.lod.maxNodes,
      lodTierCount: preparedGraph.lod_tier_count,
      nodeCount: preparedGraph.node_count,
      getPaused: () => state.lodRefreshPaused,
      onViewportLoaded: (response) => {
        updateStateFromGraphV2Viewport(state, response);
      },
      getRenderSettings: () => ({
        visualMapping: state.preparedSession?.visualMapping,
        filterState: state.activeFilters,
        metadataSchema: state.preparedSession?.metadataSchema,
      }),
    });

    const placeholderGraph = emptyGraph();
    state.currentGraph = placeholderGraph;
    state.currentSliceGraph = placeholderGraph;
    state.currentPositionedSliceGraph = placeholderGraph;
    state.graphRenderedHandler?.(placeholderGraph);
    return placeholderGraph;
  }

  throw new Error("Graph V2 viewport sync is required for LoD rendering.");
}

interface SetLodRefreshPausedArgs {
  state: GraphWorkbenchState;
  renderer: GraphRenderer;
  paused: boolean;
}

async function setLodRefreshPaused({
  state,
  renderer,
  paused,
}: SetLodRefreshPausedArgs): Promise<PositionedGraph | null> {
  if (!state.preparedSession || state.renderMode !== "lod") {
    throw new Error(ERR_LOD_PLAYBACK_REQUIRES_LOD);
  }

  state.lodRefreshPaused = paused;
  clearPendingViewRefresh(state);
  state.deferredViewState = null;
  // On resume, reconcile the frozen view to wherever the camera drifted while
  // paused. refreshNow() bypasses the pause guard in GraphViewerV2.
  if (!paused) {
    renderer.refreshGraphV2ViewportSync?.();
  }
  return state.currentGraph;
}

interface HandleViewChangeArgs {
  state: GraphWorkbenchState;
}

async function handleViewChange({
  state,
}: HandleViewChangeArgs): Promise<void> {
  const session = state.preparedSession;

  if (!session || state.renderMode !== "lod") {
    return;
  }

  clearPendingViewRefresh(state);
}

interface HandleNodeClickArgs {
  state: GraphWorkbenchState;
  clickState: RenderNodeClickState;
}

async function handleNodeClick({
  state,
  clickState,
}: HandleNodeClickArgs): Promise<void> {
  state.nodeClickedHandler?.(clickState);
}

interface SearchNodesArgs {
  state: GraphWorkbenchState;
  query: {
    query: string;
    limit?: number;
    includeMetadataKeys?: string[];
  };
}

async function searchNodes({
  state,
  query,
}: SearchNodesArgs): Promise<SearchDatasetResponse> {
  const session = state.preparedSession;

  if (!session || state.renderMode !== "lod") {
    throw new Error(ERR_NO_GRAPH_RENDERED);
  }

  return searchDatasetNodes(
    session.datasetId,
    session.metadataByNodeId,
    query,
  );
}

interface FocusNodeArgs {
  state: GraphWorkbenchState;
  renderer: GraphRenderer;
  nodeId: string;
}

async function focusNode({
  state,
  renderer,
  nodeId,
}: FocusNodeArgs): Promise<PositionedGraph> {
  const session = state.preparedSession;

  if (!session || state.renderMode !== "lod") {
    throw new Error(ERR_NO_GRAPH_RENDERED);
  }

  renderer.focusNode?.(nodeId);
  renderer.centerOnNode?.(nodeId);
  return state.currentGraph ?? state.currentSliceGraph ?? emptyGraph();
}

function disposeGraphWorkbench(
  state: GraphWorkbenchState,
  renderer: GraphRenderer,
): void {
  clearPendingViewRefresh(state);
  renderer.setViewChangeHandler?.(null);
  renderer.setNodeClickHandler?.(null);
  renderer.setRegionSelectedHandler?.(null);
  renderer.setHighlightedNodes?.(null);
  renderer.stopGraphV2ViewportSync?.();
  renderer.unmount();
}

// Fields the ancillary wheel should never fold into a distribution: the
// server's synthetic per-category count keys (they encode the counts we derive
// pie slices from, not fields in their own right) and generated bookkeeping
// fields such as profile_count. Enumerating real fields explicitly stops
// buildPieAttributes' auto path from double-counting the __category_count__
// keys as standalone numeric slices.
const GENERATED_METADATA_FIELDS = new Set(["profile_count"]);

function realMetadataFieldKeys(
  metadata: Record<string, unknown>,
): string[] {
  return Object.keys(metadata).filter(
    (key) =>
      !isCategoryCountMetadataKey(key) && !GENERATED_METADATA_FIELDS.has(key),
  );
}

function updateStateFromGraphV2Viewport(
  state: GraphWorkbenchState,
  response: GraphV2ViewportResponse,
): void {
  const graph: PositionedGraph = {
    nodes: response.nodes.map((node) => {
      const metadata = node.metadata ?? undefined;
      return {
        id: node.id,
        x: node.x,
        y: node.y,
        size: Math.max(5, Math.log1p(node.member_count) * 2),
        attributes: {
          cluster_id: node.cluster_id,
          is_cluster_proxy: node.is_representative,
          subtree_size: node.member_count,
          layout_status: node.layout_status,
          // Carry the server's per-node metadata (including the aggregated
          // __category_count__ keys) plus its derived pie__ slice attributes so
          // the ancillary distribution wheels can read a node's distribution
          // directly from the rendered-graph snapshot. Without this, the wheel
          // builders see no metadata/pie data and report "no ancillary pie
          // data" even though the Sigma node pie charts render fine (those read
          // from the separate graphology graph).
          ...(metadata ? { metadata } : {}),
          ...(metadata
            ? buildPieAttributes(metadata, {
                enabled: true,
                fields: realMetadataFieldKeys(metadata),
              })
            : {}),
        },
      };
    }),
    edges: response.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      attributes:
        typeof edge.distance === "number" && Number.isFinite(edge.distance)
          ? { distance: edge.distance }
          : undefined,
    })),
    viewMeta: {
      layout: "server",
      lodLevel: response.lod_level ?? GRAPH_V2_DETAIL_LOD_LEVEL,
      sliceNodeCount: response.nodes.length,
      sliceEdgeCount: response.edges.length,
      zoom: response.zoom,
    },
  };

  const metadataSignature = viewportMetadataSignature(response);
  if (
    metadataSignature !== state.metadataIndexSignature ||
    state.metadataIndex === null ||
    state.currentSliceDataset === null
  ) {
    const syntheticDataset = buildViewportDataset(state, response);
    state.currentSliceDataset = syntheticDataset;
    state.metadataIndex = buildMetadataIndex(syntheticDataset);
    state.metadataIndexSignature = metadataSignature;
  }
  state.currentGraph = graph;
  state.currentSliceGraph = graph;
  state.currentPositionedSliceGraph = graph;
  state.graphRenderedHandler?.(graph);
}

// A viewport's metadata index is fully determined by the dataset, layout
// version, LoD level, and the exact node-id set: the prepared layout is
// immutable, so identical keys always yield identical aggregated metadata.
// Reusing the prior index across redundant syncs (camera settle, repeated
// refreshes, unchanged pans) skips the multi-pass rebuild without ever serving
// stale stats.
function viewportMetadataSignature(response: GraphV2ViewportResponse): string {
  const nodeIds = response.nodes.map((node) => node.id).sort();
  return [
    response.dataset_id,
    response.layout_version,
    response.lod_level ?? "",
    nodeIds.length,
    nodeIds.join(","),
  ].join("|");
}

// Build a per-viewport CanonicalDataset so stats/search read live metadata.
function buildViewportDataset(
  state: GraphWorkbenchState,
  response: GraphV2ViewportResponse,
): CanonicalDataset {
  const metadataByNodeId: CanonicalDataset["metadata_by_node_id"] = {};
  response.nodes.forEach((node) => {
    if (node.metadata) {
      metadataByNodeId[node.id] = node.metadata;
    }
  });

  return {
    dataset_id: response.dataset_id,
    nodes: response.nodes.map((node) => ({
      id: node.id,
      x: node.x,
      y: node.y,
      cluster_id: node.cluster_id,
      is_cluster_proxy: node.is_representative,
      subtree_size: node.member_count,
    })),
    edges: response.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      distance: edge.distance ?? null,
    })),
    metadata_schema: state.preparedSession?.metadataSchema ?? [],
    metadata_by_node_id: metadataByNodeId,
    source: {
      format: SOURCE_FORMAT_NEWICK,
      generated_at: new Date().toISOString(),
    },
  };
}
