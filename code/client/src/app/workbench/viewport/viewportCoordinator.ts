import { retainMovedNodes } from "./retainMovedNodes";
import type { ExpansionState, ExpansionResult } from "../../../contracts/expansion";
import { composeExpandedViewport } from "./expandedViewport";
import type { GraphClient } from "../../../contracts/graph/GraphClient";
import type { GraphViewportRequest } from "../../../contracts/graph/viewport/GraphViewportRequest";
import type { GraphViewportResult } from "../../../contracts/graph/viewport/GraphViewportResult";
import type { PositionedGraph } from "../../../contracts/positioned";
import type { GraphRenderer } from "../../../render/renderer.types";
import {
  notifySnapshotApplied,
  type SnapshotApplicationReason,
  type SnapshotAppliedObserver,
} from "../internalSnapshotObserver";
import {
  buildGraphViewportRequest,
  hasViewportPixelSize,
  DEFAULT_LOD_REPRESENTATION_SPACING_PX,
  DEFAULT_GRAPH_VIEWER_DEBOUNCE_MS,
  GRAPH_VIEWER_LOD_CHANGE_DEBOUNCE_MS,
  GRAPH_VIEWER_SMALL_TREE_NODE_THRESHOLD,
  displayZoomForCameraRatio,
} from "./viewportRequest";
import {
  graphSnapshotFromViewportResponse,
  graphSnapshotWithDisplayOptions,
  type ViewportRenderSettings,
} from "./viewportSnapshot";

export interface GraphViewportCoordinatorOptions {
  datasetId: string;
  layoutVersion?: string | null;
  client: Pick<GraphClient, "readViewport">;
  renderer: GraphRenderer;
  debounceMs?: number;
  maxNodes?: number;
  representationSpacingPx?: number;
  lodTierCount?: number;
  smallTreeThreshold?: number;
  nodeCount?: number | null;
  getPaused?: () => boolean;
  onError?: (error: unknown) => void;
  getRenderSettings?: () => ViewportRenderSettings;
  onGraphApplied?: (graph: PositionedGraph, response?: GraphViewportResult) => void;
  snapshotObserver?: SnapshotAppliedObserver;
  nextSnapshotSequence?: () => number;
}

export interface ViewportRefreshOptions {
  lodLevel?: number | "finest";
  fitToResponse?: boolean;
}

export const VIEWPORT_INITIAL_FIT_DURATION_MS = 300;
export const ERR_VIEWPORT_COORDINATOR_UNMOUNTED = "Viewport sync was unmounted before the initial viewport loaded.";

export class GraphViewportCoordinator {
  private readonly datasetId: string;
  private layoutVersion?: string | null;
  private readonly client: Pick<GraphClient, "readViewport">;
  private readonly renderer: GraphRenderer;
  private readonly debounceMs: number;
  private readonly maxNodes: number | undefined;
  private readonly representationSpacingPx: number;
  private readonly lodTierCount: number;
  private readonly smallTreeThreshold: number;
  private readonly preparedNodeCount: number | null;
  private readonly getPaused?: () => boolean;
  private readonly onError?: (error: unknown) => void;
  private readonly getRenderSettings?: () => ViewportRenderSettings;
  private readonly onGraphApplied?: (graph: PositionedGraph, response?: GraphViewportResult) => void;
  private readonly snapshotObserver?: SnapshotAppliedObserver;
  private readonly nextSnapshotSequence?: () => number;
  private debounceTimer: ReturnType<typeof window.setTimeout> | null = null;
  private cancelFit: (() => void) | null = null;
  private requestSequence = 0;
  private pendingFocusSequence: number | null = null;
  private manipulating = false;
  private refreshAfterManipulation = false;
  private pendingViewportReads = 0;
  private readonly manipulationChanged = (active: boolean) => {
    this.manipulating = active;
    if (active) {
      this.refreshAfterManipulation ||= this.debounceTimer !== null || this.pendingViewportReads > 0;
      this.requestSequence += 1;
      if (this.debounceTimer !== null) window.clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
      this.cancelFit?.();
    } else if (this.refreshAfterManipulation) {
      this.refreshAfterManipulation = false;
      this.scheduleViewportRefresh(0);
    }
  };
  private mounted = false;
  private replacingLayout = false;
  private refreshAfterReplacement = false;
  private loadedInitialViewport = false;
  private lastViewportRequest: GraphViewportRequest | null = null;
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
  private readonly expandedPatches = new Map<string, GraphViewportResult>();
  private baseResponse: GraphViewportResult | null = null;
  private keepExpanded = false;
  private priorityNodeId: string | null = null;
  private allExpanded = false;
  private expansionPartial = false;
  private expansionLodLevel: number | undefined;
  private readonly viewportChanged = () => this.scheduleViewportRefreshForCamera();

  constructor(options: GraphViewportCoordinatorOptions) {
    this.datasetId = options.datasetId;
    this.layoutVersion = options.layoutVersion;
    this.client = options.client;
    this.renderer = options.renderer;
    this.debounceMs = options.debounceMs ?? DEFAULT_GRAPH_VIEWER_DEBOUNCE_MS;
    this.maxNodes = options.maxNodes;
    this.representationSpacingPx = options.representationSpacingPx ?? DEFAULT_LOD_REPRESENTATION_SPACING_PX;
    if (!Number.isFinite(this.representationSpacingPx) || this.representationSpacingPx <= 0)
      throw new Error("LoD representation spacing must be finite and positive.");
    this.lodTierCount = Math.max(options.lodTierCount ?? 1, 1);
    this.smallTreeThreshold = options.smallTreeThreshold ?? GRAPH_VIEWER_SMALL_TREE_NODE_THRESHOLD;
    this.preparedNodeCount = options.nodeCount ?? null;
    this.getPaused = options.getPaused;
    this.onError = options.onError;
    this.getRenderSettings = options.getRenderSettings;
    this.onGraphApplied = options.onGraphApplied;
    this.snapshotObserver = options.snapshotObserver;
    this.nextSnapshotSequence = options.nextSnapshotSequence;
    this.initialViewportLoaded = new Promise<PositionedGraph>((resolve, reject) => {
      this.resolveInitialViewport = resolve;
      this.rejectInitialViewport = reject;
    });
  }

  // Lifecycle

  mount(): void {
    if (this.mounted) {
      return;
    }
    this.mounted = true;
    this.renderer.setViewChangeHandler?.(this.viewportChanged);
    this.renderer.setManipulationHandler?.(this.manipulationChanged);
    this.scheduleViewportRefresh(0);
  }

  unmount(): void {
    if (!this.mounted) {
      return;
    }
    this.mounted = false;
    this.renderer.setViewChangeHandler?.(null);
    this.renderer.setManipulationHandler?.(null);
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
      this.rejectInitialViewportOnce(new Error(ERR_VIEWPORT_COORDINATOR_UNMOUNTED));
    }
  }

  waitForInitialViewport(): Promise<PositionedGraph> {
    this.initialViewportAwaited = true;
    return this.initialViewportLoaded;
  }

  // Viewport and layout replacement

  refreshNow(options: ViewportRefreshOptions = {}): void {
    if (options.lodLevel === "finest") {
      this.nextForcedLodLevel = Math.max(this.lodTierCount - 1, 0);
    } else if (typeof options.lodLevel === "number" && Number.isFinite(options.lodLevel)) {
      this.nextForcedLodLevel = Math.min(Math.max(Math.round(options.lodLevel), 0), Math.max(this.lodTierCount - 1, 0));
    }
    this.fitNextResponse = options.fitToResponse === true;
    this.scheduleViewportRefresh(0);
  }

  async replaceLayoutVersion(version: string): Promise<void> {
    if (!this.mounted || !this.loadedInitialViewport || !this.lastViewportRequest || this.replacingLayout) {
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
    const request = { ...this.lastViewportRequest, layoutVersion: version };
    try {
      const expanded = [...this.expandedPatches.keys()];
      const [response, ...patches] = await Promise.all([
        this.client.readViewport(request),
        ...expanded.map((clusterId) => this.readCluster(clusterId, undefined, version)),
      ]);
      if (!this.isCurrentRequest(sequence)) {
        throw new Error("Ancillary update was superseded by a newer view.");
      }
      if ([response, ...patches].some((item) => item.layoutVersion !== version || item.datasetId !== this.datasetId)) {
        throw new Error("Ancillary viewport returned a different layout.");
      }
      this.layoutVersion = version;
      this.lastRequestedLodLevel = request.lodLevel;
      this.totalNodeCount = response.totalNodeCount;
      this.lastViewportRequest = request;
      this.baseResponse = response;
      this.expandedPatches.clear();
      patches.forEach((patch, index) => this.expandedPatches.set(expanded[index], patch));
      const graph = this.composeGraph();
      this.applyGraph(graph, "viewport_sync", null, true);
      this.onGraphApplied?.(graph, response);
    } finally {
      this.replacingLayout = false;
      if (this.refreshAfterReplacement) {
        this.refreshAfterReplacement = false;
        this.scheduleViewportRefresh(0);
      }
    }
  }

  updateDisplayOptions(displayOptions: ViewportRenderSettings["displayOptions"]): void {
    if (!this.currentGraph) {
      return;
    }
    this.currentGraph = graphSnapshotWithDisplayOptions(this.currentGraph, displayOptions);
    this.applyGraph(this.currentGraph, "viewport_sync");
    this.onGraphApplied?.(this.currentGraph);
  }

  // Expansion

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
    else this.expansionLodLevel = this.baseResponse?.lodLevel ?? 0;
    this.requestSequence += 1;
    this.refreshNow();
    return this.getExpansionState();
  }

  cancelPendingFocus(): void {
    if (this.pendingFocusSequence === this.requestSequence) this.requestSequence += 1;
    this.pendingFocusSequence = null;
  }

  async expandCluster(
    clusterId: string,
    options: { fitToResponse?: boolean; focusNodeId?: string | null } = {},
  ): Promise<ExpansionResult> {
    this.requireExpansionReady();
    if (!clusterId) throw new Error("A cluster ID is required.");
    if (!options.focusNodeId && this.expandedPatches.has(clusterId)) return this.expansionResult();
    if (
      !options.focusNodeId &&
      this.maxNodes !== undefined &&
      (this.currentGraph?.nodes.length ?? 0) >= this.maxNodes
    ) {
      this.expansionPartial = true;
      return this.expansionResult();
    }
    const sequence = this.beginExpansion();
    if (options.focusNodeId) this.pendingFocusSequence = sequence;
    const response = await this.readExpansion(this.readCluster(clusterId, options.focusNodeId), sequence);
    if (!response) return this.expansionResult("superseded");
    if (response.totalNodeCount === 0) throw new Error("The requested cluster has no available members.");
    const settings = this.getRenderSettings?.();
    const candidate = composeExpandedViewport(
      graphSnapshotFromViewportResponse(this.baseResponse!, settings),
      [...this.expandedPatches.values(), response].map((patch) => graphSnapshotFromViewportResponse(patch, settings)),
      this.maxNodes,
    );
    const missingMembers = response.totalNodeCount > response.nodes.filter((node) => !node.isRepresentative).length;
    if (!options.focusNodeId && (response.truncated || missingMembers || candidate.partial)) {
      // Keep the summary intact rather than showing a full-group proxy alongside
      // an incomplete subset of its members.
      this.expansionPartial = true;
      return this.expansionResult();
    }
    if (options.focusNodeId) {
      if (!response.nodes.some((node) => node.id === options.focusNodeId && !node.isRepresentative)) {
        throw new Error("The requested profile is unavailable in this cluster.");
      }
      this.priorityNodeId = options.focusNodeId;
    }
    this.expandedPatches.set(clusterId, response);
    this.expansionLodLevel = this.baseResponse?.lodLevel ?? 0;
    const graph = this.composeGraph();
    this.applyGraph(graph, "cluster_expand", clusterId);
    if (options.fitToResponse) {
      this.suppressCameraRefreshUntil = Date.now() + VIEWPORT_INITIAL_FIT_DURATION_MS + this.debounceMs;
      this.cancelFit =
        this.renderer.fitGraphSnapshot?.(graphSnapshotFromViewportResponse(response, this.getRenderSettings?.()), {
          resetFirst: false,
        }) ?? null;
    }
    this.onGraphApplied?.(graph, response);
    return this.expansionResult();
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
    const request: GraphViewportRequest = {
      datasetId: this.datasetId,
      layoutVersion: this.layoutVersion,
      lodLevel: expand ? this.lodTierCount - 1 : 0,
      ...(this.maxNodes === undefined ? {} : { maxNodes: this.maxNodes }),
    };
    const response = await this.readExpansion(this.client.readViewport(request), sequence);
    if (!response) return this.expansionResult("superseded");
    this.baseResponse = response;
    this.lastViewportRequest = request;
    this.lastRequestedLodLevel = request.lodLevel;
    this.expandedPatches.clear();
    this.allExpanded = expand;
    this.expansionLodLevel = request.lodLevel ?? 0;
    const graph = this.composeGraph();
    this.applyGraph(graph, "viewport_sync");
    this.onGraphApplied?.(graph, response);
    return this.expansionResult();
  }

  collapseCluster(clusterId: string): ExpansionState {
    this.requireExpansionReady();
    this.beginExpansion();
    this.expandedPatches.delete(clusterId);
    const graph = this.composeGraph();
    this.applyGraph(graph, "cluster_collapse", clusterId);
    this.onGraphApplied?.(graph);
    return this.getExpansionState();
  }

  private requireExpansionReady(): void {
    if (!this.mounted || !this.baseResponse || this.replacingLayout || this.manipulating) {
      throw new Error("Expansion requires a loaded tree with no manipulation or ancillary replacement in progress.");
    }
  }

  private async readExpansion(
    request: Promise<GraphViewportResult>,
    sequence: number,
  ): Promise<GraphViewportResult | null> {
    try {
      const response = await request;
      return this.isCurrentRequest(sequence) ? response : null;
    } catch (error) {
      if (!this.isCurrentRequest(sequence)) return null;
      throw error;
    } finally {
      if (this.pendingFocusSequence === sequence) this.pendingFocusSequence = null;
    }
  }

  private isCurrentRequest(sequence: number): boolean {
    return this.mounted && sequence === this.requestSequence;
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
      this.priorityNodeId,
    );
    this.expansionPartial =
      composed.partial ||
      this.baseResponse!.truncated ||
      responses.some(
        (response) =>
          response.truncated ||
          response.totalNodeCount > response.nodes.filter((node) => !node.isRepresentative).length,
      );
    this.currentGraph = composed.graph;
    return composed.graph;
  }

  // Camera and viewport requests

  private scheduleViewportRefreshForCamera(): void {
    if (this.getPaused?.()) {
      return;
    }
    if ((this.keepExpanded && this.allExpanded) || (!this.viewportLodEnabled() && this.isSmallTreeLoaded())) {
      return;
    }
    const nextLodLevel = this.keepExpanded
      ? (this.expansionLodLevel ?? this.currentLodLevel())
      : this.currentLodLevel();
    const lodChanged = this.loadedInitialViewport && nextLodLevel !== this.lastRequestedLodLevel;
    if (!this.keepExpanded && !lodChanged && nextLodLevel === 0 && !this.viewportLodEnabled()) {
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

  private viewportLodEnabled(): boolean {
    return hasViewportPixelSize(this.renderer.getViewportState?.() ?? null);
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
    if (this.manipulating) {
      this.refreshAfterManipulation = true;
      return;
    }
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
    if (this.manipulating) {
      this.refreshAfterManipulation = true;
      return;
    }
    this.pendingViewportReads += 1;
    const sequence = ++this.requestSequence;
    const pinned = this.keepExpanded && this.expansionLodLevel !== undefined;
    const finestTier =
      (this.keepExpanded && this.allExpanded) ||
      (!pinned &&
        (!this.loadedInitialViewport || !this.viewportLodEnabled()) &&
        (this.isKnownSmallTree() || this.isSmallTreeLoaded()));
    const forcedLodLevel = this.nextForcedLodLevel ?? (this.keepExpanded ? this.expansionLodLevel : undefined);
    const fitResponse = this.fitNextResponse;
    this.nextForcedLodLevel = undefined;
    this.fitNextResponse = false;
    const request = buildGraphViewportRequest({
      datasetId: this.datasetId,
      layoutVersion: this.layoutVersion,
      viewState: this.renderer.getViewportState?.() ?? null,
      maxNodes: this.maxNodes,
      forceGlobal: !this.loadedInitialViewport && !finestTier,
      forceFinestTier: finestTier,
      forcedLodLevel,
      semanticLodLevel: this.isKnownSmallTree() ? this.lodTierCount - 1 : undefined,
      lodTierCount: this.lodTierCount,
      currentLodLevel: this.lastRequestedLodLevel ?? null,
      previousEffectiveLodLevel: this.baseResponse?.lodLevel,
      representationSpacingPx: this.representationSpacingPx,
    });
    this.lastRequestedLodLevel = request.lodLevel;

    try {
      let response = await this.client.readViewport(request);
      if (!this.isCurrentRequest(sequence)) {
        return;
      }
      if (!fitResponse) {
        response = retainMovedNodes(
          response,
          this.baseResponse,
          this.renderer.getVisibleDisplacedNodeIds?.() ?? [],
          this.maxNodes,
        );
      }
      this.layoutVersion = response.layoutVersion;
      this.lastViewportRequest = request;
      this.totalNodeCount = response.totalNodeCount;
      const wasInitialViewport = !this.loadedInitialViewport;
      if (!this.keepExpanded) {
        this.expandedPatches.clear();
        this.allExpanded = false;
      }
      this.baseResponse = response;
      const graph = this.composeGraph();
      this.applyGraph(graph, wasInitialViewport ? "initial_load" : "viewport_sync");
      if (fitResponse) {
        this.suppressCameraRefreshUntil = Date.now() + VIEWPORT_INITIAL_FIT_DURATION_MS + this.debounceMs;
        this.cancelFit?.();
        this.cancelFit = this.renderer.fitGraphSnapshot?.(graph, { resetFirst: false }) ?? null;
      }
      if (!fitResponse && !this.loadedInitialViewport && (request.lodLevel === 0 || finestTier)) {
        this.cancelFit?.();
        this.cancelFit = this.renderer.fitGraphSnapshot?.(graph) ?? null;
      }
      this.loadedInitialViewport = true;
      this.onGraphApplied?.(graph, response);
      if (wasInitialViewport) {
        this.resolveInitialViewportOnce(graph);
      }
    } catch (error) {
      if (!this.isCurrentRequest(sequence)) {
        return;
      }
      if (!this.loadedInitialViewport && this.initialViewportAwaited) {
        this.rejectInitialViewportOnce(error);
      }
      this.onError?.(error);
    } finally {
      this.pendingViewportReads -= 1;
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

  // Cluster requests and rendering

  private readCluster(
    clusterId: string,
    focusNodeId?: string | null,
    version = this.layoutVersion,
  ): Promise<GraphViewportResult> {
    const viewState = this.renderer.getViewportState?.() ?? null;
    return this.client.readViewport({
      datasetId: this.datasetId,
      layoutVersion: version ?? null,
      clusterId: clusterId,
      focusNodeId: focusNodeId ?? null,
      zoom: displayZoomForCameraRatio(viewState?.cameraRatio ?? 1),
      lodLevel: null,
      ...(this.maxNodes === undefined ? {} : { maxNodes: this.maxNodes }),
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
      buildGraphViewportRequest({
        datasetId: this.datasetId,
        layoutVersion: this.layoutVersion,
        viewState: this.renderer.getViewportState?.() ?? null,
        maxNodes: this.maxNodes,
        forceGlobal: !this.loadedInitialViewport,
        lodTierCount: this.lodTierCount,
        currentLodLevel: this.lastRequestedLodLevel ?? null,
        semanticLodLevel: this.isKnownSmallTree() ? this.lodTierCount - 1 : undefined,
      }).lodLevel ?? null
    );
  }
}
