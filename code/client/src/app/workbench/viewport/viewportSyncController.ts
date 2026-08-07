import type { GraphClient } from "../../../api/graphClient";
import type { GraphViewportResponse } from "../../../api/graphContracts";
import type { PositionedEdge, PositionedGraph, PositionedNode } from "../../../contracts/positioned";
import type { GraphRenderer, RenderNodeClickState } from "../../../render/renderer.types";
import {
  notifySnapshotApplied,
  type SnapshotApplicationReason,
  type SnapshotAppliedObserver,
} from "../internalSnapshotObserver";
import {
  buildGraphViewportQuery,
  DEFAULT_GRAPH_VIEWER_DEBOUNCE_MS,
  DEFAULT_GRAPH_VIEWER_MAX_NODES,
  GRAPH_VIEWER_LOD_CHANGE_DEBOUNCE_MS,
  GRAPH_VIEWER_SMALL_TREE_NODE_THRESHOLD,
  displayZoomForCameraRatio,
} from "./viewportQuery";
import {
  graphSnapshotFromViewportResponse,
  isExpandableRepresentative,
  mergeGraphSnapshots,
  type ViewportSyncSettings,
} from "./viewportSnapshot";

export interface ViewportSyncControllerOptions {
  datasetId: string;
  layoutVersion?: string | null;
  client: Pick<GraphClient, "readViewport">;
  renderer: GraphRenderer;
  debounceMs?: number;
  maxNodes?: number;
  lodTierCount?: number;
  smallTreeThreshold?: number;
  nodeCount?: number | null;
  getPaused?: () => boolean;
  onViewportLoaded?: (response: GraphViewportResponse) => void;
  onError?: (error: unknown) => void;
  getRenderSettings?: () => ViewportSyncSettings;
  onGraphSynced?: (graph: PositionedGraph, response?: GraphViewportResponse) => void;
  snapshotObserver?: SnapshotAppliedObserver;
  nextSnapshotSequence?: () => number;
}

export interface ViewportSyncRefreshOptions {
  lodLevel?: number | "finest";
  fitToResponse?: boolean;
}

export const VIEWPORT_SYNC_INITIAL_FIT_DURATION_MS = 300;
export const ERR_VIEWPORT_SYNC_UNMOUNTED = "Viewport sync was unmounted before the initial viewport loaded.";

interface CachedIncidentEdge {
  id: string;
  source: string;
  target: string;
  attributes: Record<string, unknown>;
}

interface ExpandedClusterSnapshot {
  representative: PositionedNode;
  incidentEdges: CachedIncidentEdge[];
  memberIds: string[];
}

export class ViewportSyncController {
  private readonly datasetId: string;
  private layoutVersion?: string | null;
  private readonly client: Pick<GraphClient, "readViewport">;
  private readonly renderer: GraphRenderer;
  private readonly debounceMs: number;
  private readonly maxNodes: number;
  private readonly lodTierCount: number;
  private readonly smallTreeThreshold: number;
  private readonly preparedNodeCount: number | null;
  private readonly getPaused?: () => boolean;
  private readonly onViewportLoaded?: (response: GraphViewportResponse) => void;
  private readonly onError?: (error: unknown) => void;
  private readonly getRenderSettings?: () => ViewportSyncSettings;
  private readonly onGraphSynced?: (graph: PositionedGraph, response?: GraphViewportResponse) => void;
  private readonly snapshotObserver?: SnapshotAppliedObserver;
  private readonly nextSnapshotSequence?: () => number;
  private debounceTimer: ReturnType<typeof window.setTimeout> | null = null;
  private initialFitTimer: ReturnType<typeof window.setTimeout> | null = null;
  private requestSequence = 0;
  private mounted = false;
  private loadedInitialViewport = false;
  private lastRequestedLodLevel: number | null | undefined;
  private nextForcedLodLevel: number | undefined;
  private fitNextResponse = false;
  private suppressCameraRefreshUntil = 0;
  private totalNodeCount: number | null = null;
  private currentGraph: PositionedGraph | null = null;
  private initialViewportSettled = false;
  private initialViewportAwaited = false;
  private readonly initialViewportLoaded: Promise<PositionedGraph>;
  private resolveInitialViewport: (graph: PositionedGraph) => void = () => undefined;
  private rejectInitialViewport: (error: unknown) => void = () => undefined;
  private readonly expandedClusterIds = new Set<string>();
  private readonly expandedClusterCache = new Map<string, ExpandedClusterSnapshot>();
  private readonly viewportChanged = () => this.scheduleViewportRefreshForCamera();

  constructor(options: ViewportSyncControllerOptions) {
    this.datasetId = options.datasetId;
    this.layoutVersion = options.layoutVersion;
    this.client = options.client;
    this.renderer = options.renderer;
    this.debounceMs = options.debounceMs ?? DEFAULT_GRAPH_VIEWER_DEBOUNCE_MS;
    this.maxNodes = options.maxNodes ?? DEFAULT_GRAPH_VIEWER_MAX_NODES;
    this.lodTierCount = Math.max(options.lodTierCount ?? 1, 1);
    this.smallTreeThreshold = options.smallTreeThreshold ?? GRAPH_VIEWER_SMALL_TREE_NODE_THRESHOLD;
    this.preparedNodeCount = options.nodeCount ?? null;
    this.getPaused = options.getPaused;
    this.onViewportLoaded = options.onViewportLoaded;
    this.onError = options.onError;
    this.getRenderSettings = options.getRenderSettings;
    this.onGraphSynced = options.onGraphSynced;
    this.snapshotObserver = options.snapshotObserver;
    this.nextSnapshotSequence = options.nextSnapshotSequence;
    this.initialViewportLoaded = new Promise<PositionedGraph>((resolve, reject) => {
      this.resolveInitialViewport = resolve;
      this.rejectInitialViewport = reject;
    });
  }

  mount(): void {
    if (this.mounted) {
      return;
    }
    this.mounted = true;
    this.renderer.setViewChangeHandler?.(this.viewportChanged);
    this.scheduleViewportRefresh(0);
  }

  unmount(): void {
    if (!this.mounted) {
      return;
    }
    this.mounted = false;
    this.renderer.setViewChangeHandler?.(null);
    if (this.debounceTimer !== null) {
      window.clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.initialFitTimer !== null) {
      window.clearTimeout(this.initialFitTimer);
      this.initialFitTimer = null;
    }
    this.requestSequence += 1;
    if (this.initialViewportAwaited) {
      this.rejectInitialViewportOnce(new Error(ERR_VIEWPORT_SYNC_UNMOUNTED));
    }
  }

  waitForInitialViewport(): Promise<PositionedGraph> {
    this.initialViewportAwaited = true;
    return this.initialViewportLoaded;
  }

  refreshNow(options: ViewportSyncRefreshOptions = {}): void {
    if (options.lodLevel === "finest") {
      this.nextForcedLodLevel = Math.max(this.lodTierCount - 1, 0);
    } else if (typeof options.lodLevel === "number" && Number.isFinite(options.lodLevel)) {
      this.nextForcedLodLevel = Math.min(Math.max(Math.round(options.lodLevel), 0), Math.max(this.lodTierCount - 1, 0));
    }
    this.fitNextResponse = options.fitToResponse === true;
    this.scheduleViewportRefresh(0);
  }

  handleNodeClick(state: RenderNodeClickState): void {
    const nodeId = state.nodeId;
    if (!nodeId || !isExpandableRepresentative(state.attributes)) {
      return;
    }
    const clusterId = typeof state.attributes?.cluster_id === "string" ? state.attributes.cluster_id : nodeId;
    // Sigma emits a click before its double-click event. Once this cluster is
    // expanded, that first click must not start a redundant server expansion
    // before the following double-click restores the cached local snapshot.
    if (this.expandedClusterIds.has(clusterId)) {
      return;
    }
    const snapshot = this.captureClusterSnapshot(nodeId);
    if (!snapshot) {
      return;
    }
    void this.loadCluster(clusterId, {}, snapshot);
  }

  handleNodeDoubleClick(state: RenderNodeClickState): void {
    const nodeId = state.nodeId;
    if (!nodeId) {
      return;
    }
    const clusterId = typeof state.attributes?.cluster_id === "string" ? state.attributes.cluster_id : nodeId;
    this.collapseCluster(clusterId);
  }

  expandCluster(clusterId: string, options: { fitToResponse?: boolean; focusNodeId?: string | null } = {}): void {
    if (!clusterId) {
      return;
    }
    void this.loadCluster(clusterId, options);
  }

  collapseCluster(clusterId: string): void {
    const snapshot = this.expandedClusterCache.get(clusterId);
    if (!snapshot || !this.currentGraph) {
      return;
    }

    const memberIds = new Set(snapshot.memberIds);
    const nodes = this.currentGraph.nodes.filter(
      (node) => !memberIds.has(node.id) && node.id !== snapshot.representative.id,
    );
    nodes.push(snapshot.representative);

    const nodeIds = new Set(nodes.map((node) => node.id));
    const currentEdges = this.currentGraph.edges.filter(
      (edge) =>
        !memberIds.has(edge.source) &&
        !memberIds.has(edge.target) &&
        edge.source !== snapshot.representative.id &&
        edge.target !== snapshot.representative.id,
    );
    const incidentEdges = snapshot.incidentEdges
      .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target))
      .map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        attributes: { ...edge.attributes },
      }));

    this.currentGraph = {
      ...this.currentGraph,
      nodes,
      edges: dedupeEdges([...currentEdges, ...incidentEdges]),
    };
    this.expandedClusterCache.delete(clusterId);
    this.expandedClusterIds.delete(clusterId);
    this.applyGraph(this.currentGraph, "cluster_collapse", clusterId);
    this.onGraphSynced?.(this.currentGraph);
  }

  private scheduleViewportRefreshForCamera(): void {
    if (this.getPaused?.()) {
      return;
    }
    if (Date.now() < this.suppressCameraRefreshUntil) {
      return;
    }
    if (this.isSmallTreeLoaded()) {
      return;
    }
    const nextLodLevel = this.currentLodLevel();
    const lodChanged = this.loadedInitialViewport && nextLodLevel !== this.lastRequestedLodLevel;
    if (!lodChanged && nextLodLevel === 0) {
      return;
    }
    this.scheduleViewportRefresh(lodChanged ? GRAPH_VIEWER_LOD_CHANGE_DEBOUNCE_MS : this.debounceMs);
  }

  private isSmallTreeLoaded(): boolean {
    if (!this.loadedInitialViewport) {
      return false;
    }
    if (this.preparedNodeCount !== null) {
      return this.preparedNodeCount <= this.smallTreeThreshold;
    }
    const loadedFinestTier = this.lodTierCount <= 1 || (this.lastRequestedLodLevel ?? 0) >= this.lodTierCount - 1;
    return loadedFinestTier && this.totalNodeCount !== null && this.totalNodeCount <= this.smallTreeThreshold;
  }

  private isKnownSmallTree(): boolean {
    return this.preparedNodeCount !== null && this.preparedNodeCount <= this.smallTreeThreshold;
  }

  private scheduleViewportRefresh(delayMs = this.debounceMs): void {
    if (!this.mounted) {
      return;
    }
    if (this.debounceTimer !== null) {
      window.clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = window.setTimeout(() => {
      this.debounceTimer = null;
      void this.loadViewport();
    }, delayMs);
  }

  private async loadViewport(): Promise<void> {
    const sequence = ++this.requestSequence;
    const finestTier = this.isKnownSmallTree() || this.isSmallTreeLoaded();
    const forcedLodLevel = this.nextForcedLodLevel;
    const fitResponse = this.fitNextResponse;
    this.nextForcedLodLevel = undefined;
    this.fitNextResponse = false;
    const query = buildGraphViewportQuery({
      datasetId: this.datasetId,
      layoutVersion: this.layoutVersion,
      viewState: this.renderer.getViewportSyncState?.() ?? null,
      maxNodes: this.maxNodes,
      forceGlobal: !this.loadedInitialViewport && !finestTier,
      forceFinestTier: finestTier,
      forcedLodLevel,
      lodTierCount: this.lodTierCount,
      currentLodLevel: this.lastRequestedLodLevel ?? null,
    });
    this.lastRequestedLodLevel = query.lod_level;

    try {
      const response = await this.client.readViewport(query);
      if (!this.mounted || sequence !== this.requestSequence) {
        return;
      }
      this.layoutVersion = response.layout_version;
      this.totalNodeCount = response.total_node_count;
      const graph = graphSnapshotFromViewportResponse(response, this.getRenderSettings?.());
      const wasInitialViewport = !this.loadedInitialViewport;
      this.currentGraph = graph;
      this.applyGraph(graph, wasInitialViewport ? "initial_load" : "viewport_sync");
      if (fitResponse) {
        this.suppressCameraRefreshUntil = Date.now() + VIEWPORT_SYNC_INITIAL_FIT_DURATION_MS + this.debounceMs;
        this.initialFitTimer = this.renderer.fitGraphSnapshot?.(graph, { resetFirst: false }) ?? null;
      }
      if (!fitResponse && !this.loadedInitialViewport && (query.lod_level === 0 || finestTier)) {
        this.initialFitTimer = this.renderer.fitGraphSnapshot?.(graph) ?? null;
      }
      this.loadedInitialViewport = true;
      this.onGraphSynced?.(graph, response);
      this.onViewportLoaded?.(response);
      if (wasInitialViewport) {
        this.resolveInitialViewportOnce(graph);
      }
    } catch (error) {
      if (!this.mounted || sequence !== this.requestSequence) {
        return;
      }
      if (!this.loadedInitialViewport && this.initialViewportAwaited) {
        this.rejectInitialViewportOnce(error);
      }
      this.onError?.(error);
    }
  }

  private resolveInitialViewportOnce(graph: PositionedGraph): void {
    if (this.initialViewportSettled) {
      return;
    }
    this.initialViewportSettled = true;
    this.resolveInitialViewport(graph);
  }

  private rejectInitialViewportOnce(error: unknown): void {
    if (this.initialViewportSettled) {
      return;
    }
    this.initialViewportSettled = true;
    this.rejectInitialViewport(error);
  }

  private async loadCluster(
    clusterId: string,
    options: { fitToResponse?: boolean; focusNodeId?: string | null },
    snapshot?: ExpandedClusterSnapshot,
  ): Promise<void> {
    const sequence = ++this.requestSequence;
    try {
      const response = await this.readCluster(clusterId, options.focusNodeId);
      if (!this.mounted || sequence !== this.requestSequence) {
        return;
      }
      this.layoutVersion = response.layout_version;
      const patch = graphSnapshotFromViewportResponse(response, this.getRenderSettings?.());
      this.currentGraph = this.currentGraph ? mergeGraphSnapshots(this.currentGraph, patch) : patch;
      if (snapshot) {
        snapshot.memberIds = response.nodes.filter((node) => !node.is_representative).map((node) => node.id);
        this.expandedClusterCache.set(clusterId, snapshot);
        this.expandedClusterIds.add(clusterId);
      }
      this.applyGraph(this.currentGraph, "cluster_expand", clusterId);
      if (options.fitToResponse) {
        this.suppressCameraRefreshUntil = Date.now() + VIEWPORT_SYNC_INITIAL_FIT_DURATION_MS + this.debounceMs;
        this.initialFitTimer = this.renderer.fitGraphSnapshot?.(patch, { resetFirst: false }) ?? null;
      }
      this.onGraphSynced?.(this.currentGraph, response);
      this.onViewportLoaded?.(response);
    } catch (error) {
      if (!this.mounted || sequence !== this.requestSequence) {
        return;
      }
      this.onError?.(error);
    }
  }

  private readCluster(clusterId: string, focusNodeId?: string | null): Promise<GraphViewportResponse> {
    const viewState = this.renderer.getViewportSyncState?.() ?? null;
    return this.client.readViewport({
      dataset_id: this.datasetId,
      layout_version: this.layoutVersion ?? null,
      cluster_id: clusterId,
      focus_node_id: focusNodeId ?? null,
      zoom: displayZoomForCameraRatio(viewState?.cameraRatio ?? 1),
      lod_level: null,
      max_nodes: this.maxNodes,
    });
  }

  private captureClusterSnapshot(representativeId: string): ExpandedClusterSnapshot | null {
    const graph = this.currentGraph;
    const representative = graph?.nodes.find((node) => node.id === representativeId);
    if (!graph || !representative) {
      return null;
    }
    return {
      representative: cloneNode(representative),
      incidentEdges: graph.edges
        .filter((edge) => edge.source === representativeId || edge.target === representativeId)
        .map((edge) => ({
          id: edge.id,
          source: edge.source,
          target: edge.target,
          attributes: { ...(edge.attributes ?? {}) },
        })),
      memberIds: [],
    };
  }

  private applyGraph(graph: PositionedGraph, reason: SnapshotApplicationReason, clusterId: string | null = null): void {
    if (!this.renderer.applyGraphSnapshot) {
      throw new Error("Viewport sync requires a renderer that can apply graph snapshots.");
    }
    this.renderer.applyGraphSnapshot(graph);
    notifySnapshotApplied({
      observer: this.snapshotObserver,
      sequence: this.snapshotObserver ? (this.nextSnapshotSequence?.() ?? 0) : 0,
      reason,
      datasetId: this.datasetId,
      layoutVersion: this.layoutVersion,
      clusterId,
      graph,
      renderer: this.renderer,
    });
  }

  private currentLodLevel(): number | null {
    return (
      buildGraphViewportQuery({
        datasetId: this.datasetId,
        layoutVersion: this.layoutVersion,
        viewState: this.renderer.getViewportSyncState?.() ?? null,
        maxNodes: this.maxNodes,
        forceGlobal: !this.loadedInitialViewport,
        lodTierCount: this.lodTierCount,
        currentLodLevel: this.lastRequestedLodLevel ?? null,
      }).lod_level ?? null
    );
  }
}

function cloneNode(node: PositionedNode): PositionedNode {
  return {
    ...node,
    attributes: node.attributes ? { ...node.attributes } : undefined,
  };
}

function dedupeEdges(edges: PositionedEdge[]): PositionedEdge[] {
  return Array.from(new Map(edges.map((edge) => [edge.id, edge])).values());
}
