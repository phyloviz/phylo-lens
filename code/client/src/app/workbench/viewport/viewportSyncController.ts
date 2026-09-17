import type { ExpansionState, ExpansionResult } from "../../../contracts/expansion";
import { composeExpandedViewport } from "./expandedViewport";
import type { GraphClient } from "../../../api/graphClient";
import type { GraphViewportQuery, GraphViewportResponse } from "../../../api/graphContracts";
import type { PositionedGraph } from "../../../contracts/positioned";
import type { GraphRenderer } from "../../../render/renderer.types";
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
  graphSnapshotWithDisplayOptions,
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
  private cancelFit: (() => void) | null = null;
  private requestSequence = 0;
  private mounted = false;
  private replacingLayout = false;
  private refreshAfterReplacement = false;
  private loadedInitialViewport = false;
  private lastViewportQuery: GraphViewportQuery | null = null;
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
  private readonly expandedPatches = new Map<string, GraphViewportResponse>();
  private baseResponse: GraphViewportResponse | null = null;
  private keepExpanded = false;
  private allExpanded = false;
  private expansionPartial = false;
  private expansionLodLevel: number | undefined;
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
    if (this.cancelFit !== null) {
      this.cancelFit();
      this.cancelFit = null;
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

  async replaceLayoutVersion(version: string): Promise<void> {
    if (!this.mounted || !this.loadedInitialViewport || !this.lastViewportQuery || this.replacingLayout) {
      throw new Error(
        "Cannot replace ancillary data before the view is ready or while another replacement is pending.",
      );
    }
    this.replacingLayout = true;
    this.nextForcedLodLevel = undefined;
    this.fitNextResponse = false;
    const sequence = ++this.requestSequence;
    if (this.debounceTimer !== null) {
      window.clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    // An ancillary update must never refit the camera, including a pending initial fit.
    if (this.cancelFit !== null) {
      this.cancelFit();
      this.cancelFit = null;
    }
    const query = { ...this.lastViewportQuery, layout_version: version };
    try {
      const expanded = [...this.expandedPatches.keys()];
      const [response, ...patches] = await Promise.all([
        this.client.readViewport(query),
        ...expanded.map((clusterId) => this.readCluster(clusterId, undefined, version)),
      ]);
      if (!this.mounted || sequence !== this.requestSequence) {
        throw new Error("Ancillary update was superseded by a newer view.");
      }
      if (
        [response, ...patches].some((item) => item.layout_version !== version || item.dataset_id !== this.datasetId)
      ) {
        throw new Error("Ancillary viewport returned a different layout.");
      }
      this.layoutVersion = version;
      this.lastRequestedLodLevel = query.lod_level;
      this.totalNodeCount = response.total_node_count;
      this.lastViewportQuery = query;
      this.baseResponse = response;
      this.expandedPatches.clear();
      patches.forEach((patch, index) => this.expandedPatches.set(expanded[index], patch));
      const graph = this.composeGraph();
      this.applyGraph(graph, "viewport_sync", null, true);
      this.onGraphSynced?.(graph, response);
      this.onViewportLoaded?.(response);
    } finally {
      this.replacingLayout = false;
      if (this.refreshAfterReplacement) {
        this.refreshAfterReplacement = false;
        this.scheduleViewportRefresh(0);
      }
    }
  }

  updateDisplayOptions(displayOptions: ViewportSyncSettings["displayOptions"]): void {
    if (!this.currentGraph) {
      return;
    }
    this.currentGraph = graphSnapshotWithDisplayOptions(this.currentGraph, displayOptions);
    this.applyGraph(this.currentGraph, "viewport_sync");
    this.onGraphSynced?.(this.currentGraph);
  }

  getExpansionState(): ExpansionState {
    return {
      keepExpanded: this.keepExpanded,
      expandedClusterIds: [...this.expandedPatches.keys()],
      allExpanded: this.allExpanded && !this.expansionPartial,
      partial: this.expansionPartial,
      renderedNodeCount: this.currentGraph?.nodes.length ?? 0,
      maxNodes: this.maxNodes,
    };
  }

  setKeepExpanded(keep: boolean): ExpansionState {
    this.requireExpansionReady();
    this.keepExpanded = keep;
    if (!keep) this.expansionLodLevel = undefined;
    else this.expansionLodLevel = this.baseResponse?.lod_level ?? 0;
    this.requestSequence += 1;
    this.refreshNow();
    return this.getExpansionState();
  }

  expandCluster(
    clusterId: string,
    options: { fitToResponse?: boolean; focusNodeId?: string | null } = {},
  ): Promise<ExpansionResult> {
    return this.loadCluster(clusterId, options);
  }

  expandAll(): Promise<ExpansionResult> {
    return this.loadGlobalExpansion(true);
  }

  collapseAll(): Promise<ExpansionResult> {
    return this.loadGlobalExpansion(false);
  }

  private async loadGlobalExpansion(expand: boolean): Promise<ExpansionResult> {
    this.requireExpansionReady();
    const sequence = this.beginExpansion();
    const query: GraphViewportQuery = {
      dataset_id: this.datasetId,
      layout_version: this.layoutVersion,
      lod_level: expand ? this.lodTierCount - 1 : 0,
      max_nodes: this.maxNodes,
    };
    const response = await this.readExpansion(this.client.readViewport(query), sequence);
    if (!response) return this.expansionResult("superseded");
    this.baseResponse = response;
    this.lastViewportQuery = query;
    this.lastRequestedLodLevel = query.lod_level;
    this.expandedPatches.clear();
    this.allExpanded = expand;
    this.expansionLodLevel = query.lod_level ?? 0;
    const graph = this.composeGraph();
    this.applyGraph(graph, "viewport_sync");
    this.onGraphSynced?.(graph, response);
    return this.expansionResult();
  }

  collapseCluster(clusterId: string): ExpansionState {
    this.requireExpansionReady();
    this.beginExpansion();
    this.expandedPatches.delete(clusterId);
    const graph = this.composeGraph();
    this.applyGraph(graph, "cluster_collapse", clusterId);
    this.onGraphSynced?.(graph);
    return this.getExpansionState();
  }

  private requireExpansionReady(): void {
    if (!this.mounted || !this.baseResponse || this.replacingLayout) {
      throw new Error("Expansion requires a loaded tree with no ancillary replacement in progress.");
    }
  }

  private async readExpansion(
    request: Promise<GraphViewportResponse>,
    sequence: number,
  ): Promise<GraphViewportResponse | null> {
    try {
      const response = await request;
      return this.mounted && sequence === this.requestSequence ? response : null;
    } catch (error) {
      if (!this.mounted || sequence !== this.requestSequence) return null;
      throw error;
    }
  }

  private beginExpansion(): number {
    if (this.debounceTimer !== null) window.clearTimeout(this.debounceTimer);
    this.debounceTimer = null;
    this.cancelFit?.();
    return ++this.requestSequence;
  }

  private expansionResult(status?: "superseded"): ExpansionResult {
    return { ...this.getExpansionState(), status: status ?? (this.expansionPartial ? "partial" : "complete") };
  }

  private composeGraph(): PositionedGraph {
    const responses = [...this.expandedPatches.values()];
    const settings = this.getRenderSettings?.();
    const composed = composeExpandedViewport(
      graphSnapshotFromViewportResponse(this.baseResponse!, settings),
      responses.map((response) => graphSnapshotFromViewportResponse(response, settings)),
      this.maxNodes,
    );
    this.expansionPartial =
      composed.partial ||
      this.baseResponse!.truncated ||
      responses.some(
        (response) =>
          response.truncated ||
          response.total_node_count > response.nodes.filter((node) => !node.is_representative).length,
      );
    this.currentGraph = composed.graph;
    return composed.graph;
  }

  private scheduleViewportRefreshForCamera(): void {
    if (this.getPaused?.()) {
      return;
    }
    if ((this.keepExpanded && this.allExpanded) || this.isSmallTreeLoaded()) {
      return;
    }
    const nextLodLevel = this.keepExpanded
      ? (this.expansionLodLevel ?? this.currentLodLevel())
      : this.currentLodLevel();
    const lodChanged = this.loadedInitialViewport && nextLodLevel !== this.lastRequestedLodLevel;
    if (!lodChanged && nextLodLevel === 0) {
      return;
    }
    // Keep the last camera change even when a fit animation is still settling.
    // Otherwise interrupting that animation can leave the viewport unfetched.
    this.scheduleViewportRefresh(
      Math.max(
        lodChanged ? GRAPH_VIEWER_LOD_CHANGE_DEBOUNCE_MS : this.debounceMs,
        this.suppressCameraRefreshUntil - Date.now(),
      ),
    );
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
    if (this.replacingLayout) {
      this.refreshAfterReplacement = true;
      return;
    }
    if (!this.mounted) {
      return;
    }
    if (this.debounceTimer !== null) {
      window.clearTimeout(this.debounceTimer);
    }
    // Invalidate immediately: an old response can arrive during the debounce window.
    this.requestSequence += 1;
    this.debounceTimer = window.setTimeout(() => {
      this.debounceTimer = null;
      void this.loadViewport();
    }, delayMs);
  }

  private async loadViewport(): Promise<void> {
    const sequence = ++this.requestSequence;
    const pinned = this.keepExpanded && this.expansionLodLevel !== undefined;
    const finestTier =
      (this.keepExpanded && this.allExpanded) || (!pinned && (this.isKnownSmallTree() || this.isSmallTreeLoaded()));
    const forcedLodLevel = this.nextForcedLodLevel ?? (this.keepExpanded ? this.expansionLodLevel : undefined);
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
      this.lastViewportQuery = query;
      this.totalNodeCount = response.total_node_count;
      const wasInitialViewport = !this.loadedInitialViewport;
      if (!this.keepExpanded) {
        this.expandedPatches.clear();
        this.allExpanded = false;
      }
      this.baseResponse = response;
      const graph = this.composeGraph();
      this.applyGraph(graph, wasInitialViewport ? "initial_load" : "viewport_sync");
      if (fitResponse) {
        this.suppressCameraRefreshUntil = Date.now() + VIEWPORT_SYNC_INITIAL_FIT_DURATION_MS + this.debounceMs;
        this.cancelFit?.();
        this.cancelFit = this.renderer.fitGraphSnapshot?.(graph, { resetFirst: false }) ?? null;
      }
      if (!fitResponse && !this.loadedInitialViewport && (query.lod_level === 0 || finestTier)) {
        this.cancelFit?.();
        this.cancelFit = this.renderer.fitGraphSnapshot?.(graph) ?? null;
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
  ): Promise<ExpansionResult> {
    this.requireExpansionReady();
    if (!clusterId) throw new Error("A cluster ID is required.");
    if (this.expandedPatches.has(clusterId)) return this.expansionResult();
    if (!options.focusNodeId && (this.currentGraph?.nodes.length ?? 0) >= this.maxNodes) {
      this.expansionPartial = true;
      return this.expansionResult();
    }
    const sequence = this.beginExpansion();
    const response = await this.readExpansion(this.readCluster(clusterId, options.focusNodeId), sequence);
    if (!response) return this.expansionResult("superseded");
    if (response.total_node_count === 0) throw new Error("The requested cluster has no available members.");
    const settings = this.getRenderSettings?.();
    const candidate = composeExpandedViewport(
      graphSnapshotFromViewportResponse(this.baseResponse!, settings),
      [...this.expandedPatches.values(), response].map((patch) => graphSnapshotFromViewportResponse(patch, settings)),
      this.maxNodes,
    );
    const missingMembers = response.total_node_count > response.nodes.filter((node) => !node.is_representative).length;
    if (!options.focusNodeId && (response.truncated || missingMembers || candidate.partial)) {
      // Keep the summary intact rather than showing a full-group proxy alongside
      // an incomplete subset of its members.
      this.expansionPartial = true;
      return this.expansionResult();
    }
    this.expandedPatches.set(clusterId, response);
    this.expansionLodLevel = this.baseResponse?.lod_level ?? 0;
    const graph = this.composeGraph();
    this.applyGraph(graph, "cluster_expand", clusterId);
    if (options.fitToResponse) {
      this.suppressCameraRefreshUntil = Date.now() + VIEWPORT_SYNC_INITIAL_FIT_DURATION_MS + this.debounceMs;
      this.cancelFit =
        this.renderer.fitGraphSnapshot?.(graphSnapshotFromViewportResponse(response, this.getRenderSettings?.()), {
          resetFirst: false,
        }) ?? null;
    }
    this.onGraphSynced?.(graph, response);
    this.onViewportLoaded?.(response);
    return this.expansionResult();
  }

  private readCluster(
    clusterId: string,
    focusNodeId?: string | null,
    version = this.layoutVersion,
  ): Promise<GraphViewportResponse> {
    const viewState = this.renderer.getViewportSyncState?.() ?? null;
    return this.client.readViewport({
      dataset_id: this.datasetId,
      layout_version: version ?? null,
      cluster_id: clusterId,
      focus_node_id: focusNodeId ?? null,
      zoom: displayZoomForCameraRatio(viewState?.cameraRatio ?? 1),
      lod_level: null,
      max_nodes: this.maxNodes,
    });
  }

  private applyGraph(
    graph: PositionedGraph,
    reason: SnapshotApplicationReason,
    clusterId: string | null = null,
    preservePositions = false,
  ): void {
    if (!this.renderer.applyGraphSnapshot) {
      throw new Error("Viewport sync requires a renderer that can apply graph snapshots.");
    }
    if (preservePositions) this.renderer.applyGraphSnapshot(graph, { preservePositions: true });
    else this.renderer.applyGraphSnapshot(graph);
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
