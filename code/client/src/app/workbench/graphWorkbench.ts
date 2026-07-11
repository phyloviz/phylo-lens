import type { GraphClient } from "../../api/graphClient";
import type {
  GraphViewportResponse,
  NormalizeRequest,
} from "../../api/graphContracts";
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
  GraphDisplayOptions,
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
import type { SigmaViewportBounds } from "../../render/adapters/sigma/graphViewerTypes";
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
import {
  clearPendingViewRefresh,
  createInitialGraphWorkbenchState,
  resetWorkbenchForNewDataset,
} from "./workbenchState";

export {
  DEFAULT_VIEWPORT,
  DEFAULT_VIEW_SLICE_MAX_NODES,
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
export const GRAPH_DETAIL_LOD_LEVEL = 3;
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
        graphClient: options.graphClient,
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

    updateDisplayOptions: (displayOptions) =>
      updateDisplayOptions({ state, renderer, displayOptions }),

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
        graphClient: options.graphClient,
        query,
      }),

    focusNode: (nodeId, coordinates) =>
      focusNode({
        state,
        renderer,
        nodeId,
        coordinates,
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
        graphClient: options.graphClient,
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
  graphClient: GraphClient;
  bounds: SigmaViewportBounds;
}

async function selectRegion({
  state,
  renderer,
  graphClient,
  bounds,
}: SelectRegionArgs): Promise<RegionSelectionResult> {
  const session = state.preparedSession;

  if (!session || state.renderMode !== "lod") {
    throw new Error(ERR_NO_GRAPH_RENDERED);
  }

  const response = await graphClient.readRegion({
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
  graphClient: GraphClient;
  newick: string;
  datasetName?: string;
  options?: RenderNewickOptions;
}

async function renderNewick({
  state,
  renderer,
  graphClient,
  newick,
  datasetName = DEFAULT_DATASET_NAME,
  options = {},
}: RenderNewickArgs): Promise<PositionedGraph> {
  resetWorkbenchForNewDataset(state);
  renderer.focusNode?.(null);

  const request: NormalizeRequest = {
    format: options.sourceFormat ?? SOURCE_FORMAT_NEWICK,
    dataset_name: datasetName,
    content: newick,
    metadata_schema: options.metadataSchema ?? [],
    metadata_by_node_id: options.metadataByNodeId ?? {},
    ancillary_data: options.ancillaryData,
  };

  if (renderer.startGraphViewportSync) {
    const preparedGraph = await graphClient.prepareGraph(request);

    state.renderMode = "lod";
    state.preparedSession = {
      datasetId: preparedGraph.dataset_id,
      layoutVersion: preparedGraph.layout_version,
      metadataSchema: options.metadataSchema ?? [],
      metadataByNodeId: options.metadataByNodeId ?? {},
      ancillaryRowsByNodeId: {},
      visualMapping: options.visualMapping,
      layoutWarnings: preparedGraph.warnings,
      layout: options.layout,
      lodTierCount: preparedGraph.lod_tier_count,
      lod: {
        maxNodes: options.lod?.maxNodes ?? DEFAULT_VIEW_SLICE_MAX_NODES,
        lodHint: options.lod?.lodHint,
        viewport: options.lod?.viewport ?? DEFAULT_VIEWPORT,
      },
    };
    state.currentSliceDataset = null;

    renderer.startGraphViewportSync({
      client: graphClient,
      datasetId: preparedGraph.dataset_id,
      layoutVersion: preparedGraph.layout_version,
      maxNodes: state.preparedSession.lod.maxNodes,
      lodTierCount: preparedGraph.lod_tier_count,
      nodeCount: preparedGraph.node_count,
      getPaused: () => state.lodRefreshPaused,
      onViewportLoaded: (response) => {
        updateStateFromGraphViewport(state, response);
      },
      getRenderSettings: () => ({
        visualMapping: state.preparedSession?.visualMapping,
        filterState: state.activeFilters,
        metadataSchema: state.preparedSession?.metadataSchema,
        displayOptions: state.preparedSession?.displayOptions,
        selectedNodeId: state.focusedNodeId,
      }),
    });

    const placeholderGraph = emptyGraph();
    state.currentGraph = placeholderGraph;
    state.currentSliceGraph = placeholderGraph;
    state.currentPositionedSliceGraph = placeholderGraph;
    state.graphRenderedHandler?.(placeholderGraph);
    return placeholderGraph;
  }

  throw new Error("Graph viewport sync is required for LoD rendering.");
}

interface UpdateDisplayOptionsArgs {
  state: GraphWorkbenchState;
  renderer: GraphRenderer;
  displayOptions: GraphDisplayOptions;
}

// Apply presentation toggles (node labels, edge distance labels, distance-
// weighted edges) to the live LoD view. The renderer owns two concerns:
// updateDisplayOptions rebuilds Sigma settings (so the node-label toggle takes
// effect and the live viewer stays bound), and the persisted session options
// are re-read by getRenderSettings on the next viewport sync, which
// refreshGraphViewportSync forces immediately. We deliberately do NOT call
// renderer.render() here: under LoD that clears the live viewport graph and
// repopulates it from a stale coarse snapshot, resurfacing cluster-proxy
// triangles and freezing the sync loop.
function updateDisplayOptions({
  state,
  renderer,
  displayOptions,
}: UpdateDisplayOptionsArgs): void {
  if (state.preparedSession) {
    state.preparedSession.displayOptions = {
      ...state.preparedSession.displayOptions,
      ...displayOptions,
    };
  }
  renderer.updateDisplayOptions?.(displayOptions);
  renderer.refreshGraphViewportSync?.();
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
  // paused. refreshNow() bypasses the pause guard in GraphViewer.
  if (!paused) {
    renderer.refreshGraphViewportSync?.();
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
  graphClient: GraphClient;
  query: {
    query: string;
    limit?: number;
    includeMetadataKeys?: string[];
  };
}

// Whole-tree search runs on the server against the immutable prepared layout, so
// a node is found regardless of the current zoom/pan (the visible slice only
// ever holds a viewport's worth of nodes). The server scores id and metadata
// hits; we map its matches onto the existing SearchDatasetResponse contract.
async function searchNodes({
  state,
  graphClient,
  query,
}: SearchNodesArgs): Promise<SearchDatasetResponse> {
  const session = state.preparedSession;

  if (!session || state.renderMode !== "lod") {
    throw new Error(ERR_NO_GRAPH_RENDERED);
  }

  const response = await graphClient.searchGraph({
    dataset_id: session.datasetId,
    layout_version: session.layoutVersion ?? null,
    query: query.query,
    limit: query.limit,
  });

  return {
    dataset_id: response.dataset_id,
    query: response.query,
    matches: response.matches.map((match) => ({
      node_id: match.node_id,
      score: match.score,
      matched_text: match.matched_text,
      metadata: {},
      // Carry the server-resolved global coordinates so the focus flow can fetch
      // a region around a hit that lies outside the current LoD slice.
      x: match.x ?? null,
      y: match.y ?? null,
    })),
    total_count: response.total_count,
  };
}

interface FocusNodeArgs {
  state: GraphWorkbenchState;
  renderer: GraphRenderer;
  nodeId: string;
  coordinates?: { x: number | null; y: number | null };
}

async function focusNode({
  state,
  renderer,
  nodeId,
  coordinates,
}: FocusNodeArgs): Promise<PositionedGraph> {
  const session = state.preparedSession;

  if (!session || state.renderMode !== "lod") {
    throw new Error(ERR_NO_GRAPH_RENDERED);
  }

  // Remember the focus so every subsequent viewport re-fetch re-highlights the
  // node in red (the LoD sync reads this via getRenderSettings.selectedNodeId).
  state.focusedNodeId = nodeId;
  renderer.focusNode?.(nodeId);

  // Try to center on the node in the current slice first. If it is not loaded
  // (outside the current LoD view), move the camera to the search hit's global
  // coordinates and force a viewport re-fetch so the node's slice is pulled in;
  // the sync then renders it as the selected (red) node.
  const centeredInSlice = renderer.centerOnNode?.(nodeId);
  if (
    centeredInSlice !== true &&
    coordinates &&
    coordinates.x !== null &&
    coordinates.y !== null &&
    renderer.centerOnCoordinates?.(coordinates.x, coordinates.y) === true
  ) {
    renderer.refreshGraphViewportSync?.();
  }

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
  renderer.stopGraphViewportSync?.();
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

function updateStateFromGraphViewport(
  state: GraphWorkbenchState,
  response: GraphViewportResponse,
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
      lodLevel: response.lod_level ?? GRAPH_DETAIL_LOD_LEVEL,
      lodTierCount: state.preparedSession?.lodTierCount,
      sliceNodeCount: response.nodes.length,
      sliceEdgeCount: response.edges.length,
      zoom: response.zoom,
      layoutStatus: response.layout_status,
      layoutWarnings: state.preparedSession?.layoutWarnings,
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
function viewportMetadataSignature(response: GraphViewportResponse): string {
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
  response: GraphViewportResponse,
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
