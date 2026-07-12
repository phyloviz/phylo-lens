import type Graph from "graphology";

import type { GraphClient } from "../../../../api/graphClient";
import type { GraphViewportResponse } from "../../../../api/graphContracts";
import {
  buildGraphViewportQuery,
  DEFAULT_GRAPH_VIEWER_DEBOUNCE_MS,
  DEFAULT_GRAPH_VIEWER_MAX_NODES,
  GRAPH_VIEWER_LOD_CHANGE_DEBOUNCE_MS,
  GRAPH_VIEWER_SMALL_TREE_NODE_THRESHOLD,
  sigmaDisplayZoom,
} from "./graphViewportQuery";
import { fitSigmaToViewportResponse, GRAPH_VIEWER_INITIAL_FIT_DURATION_MS } from "./graphViewportFit";
import { isExpandableRepresentative, reconcileGraphologyViewport, syncGraphologyViewport } from "./graphViewportSync";
import type { ViewportSyncSettings } from "./graphViewportSync";
import type { SigmaViewportLike } from "./graphViewport.types";

export {
  buildGraphViewportQuery,
  DEFAULT_GRAPH_VIEWER_DEBOUNCE_MS,
  DEFAULT_GRAPH_VIEWER_MAX_NODES,
  expandViewportBounds,
  GRAPH_VIEWER_DETAIL_RATIO_THRESHOLD,
  GRAPH_VIEWER_LOD_CHANGE_DEBOUNCE_MS,
  GRAPH_VIEWER_SMALL_TREE_NODE_THRESHOLD,
  GRAPH_VIEWER_VIEWPORT_PADDING_RATIO,
  semanticLodLevelForCameraRatio,
  semanticLodLevelForCameraRatioWithHysteresis,
  sigmaViewportBounds,
} from "./graphViewportQuery";
export {
  fitSigmaToClusterResponse,
  fitSigmaToViewportResponse,
  GRAPH_VIEWER_CLUSTER_FIT_DURATION_MS,
  GRAPH_VIEWER_CLUSTER_FIT_PADDING_RATIO,
  GRAPH_VIEWER_FIT_PADDING_RATIO,
  GRAPH_VIEWER_INITIAL_FIT_DELAY_MS,
  GRAPH_VIEWER_INITIAL_FIT_DURATION_MS,
} from "./graphViewportFit";
export {
  DEFAULT_GRAPH_VIEWER_NODE_SIZE,
  GRAPH_VIEWER_EDGE_COLOR,
  GRAPH_VIEWER_MAX_MEMBER_SIZE_BOOST,
  GRAPH_VIEWER_MEMBER_SIZE_FACTOR,
  GRAPH_VIEWER_NODE_COLOR,
  GRAPH_VIEWER_REPRESENTATIVE_COLOR,
  deriveViewportNodeColor,
  nodeSizeForMemberCount,
  reconcileGraphologyViewport,
  syncGraphologyViewport,
} from "./graphViewportSync";
export type { ViewportSyncSettings } from "./graphViewportSync";
export type { SigmaViewportBounds } from "./graphViewport.types";

// GraphViewportController only issues viewport reads; region reads are driven from the UI
// shell, not the LoD sync loop. Depending on just the viewport slice keeps the
// viewer decoupled and lets lightweight test doubles omit the rest of the API.
export type GraphViewportClientDependency = Pick<GraphClient, "readViewport">;

export interface GraphViewportControllerOptions {
  datasetId: string;
  layoutVersion?: string | null;
  client: GraphViewportClientDependency;
  graph: Graph;
  sigma: SigmaViewportLike;
  debounceMs?: number;
  maxNodes?: number;
  // Number of precomputed LoD tiers from the prepare response. Governs how many
  // semantic-zoom levels the camera ratio is mapped across. Defaults to 1
  // (overview only) when the prepare response predates this field.
  lodTierCount?: number;
  // Trees at or below this node count skip semantic zooming: the whole tree is
  // rendered once at LOD 0 and camera movement never re-queries the server.
  smallTreeThreshold?: number;
  // Prepared node count from the prepare response, known before the first
  // viewport response. When <= smallTreeThreshold, the initial load requests
  // the finest tier so a small tree opens as individual nodes rather than the
  // triangle overview.
  nodeCount?: number | null;
  // Reports whether LOD refresh is paused. When paused, camera movement must
  // not trigger new server viewport queries; the current node/edge set stays
  // frozen until playback resumes.
  getPaused?: () => boolean;
  onViewportLoaded?: (response: GraphViewportResponse) => void;
  onError?: (error: unknown) => void;
  getRenderSettings?: () => ViewportSyncSettings;
  // Fires after each viewport sync writes into the graph but before Sigma
  // refreshes, letting the renderer register piechart programs / flip node
  // types (and rebind this viewer via rebindSigma) while attributes are fresh.
  onGraphSynced?: (response?: GraphViewportResponse) => void;
}

export interface GraphViewportRefreshOptions {
  lodLevel?: number | "finest";
  fitToResponse?: boolean;
}

// One incident edge of a cluster representative, captured before expansion so
// collapse can restore it verbatim.
interface CachedIncidentEdge {
  id: string;
  source: string;
  target: string;
  attributes: Record<string, unknown>;
}

// Everything needed to rebuild a collapsed cluster proxy from cache without a
// server round-trip: the representative node and the edges that touched it.
interface ExpandedClusterSnapshot {
  representativeId: string;
  representativeAttributes: Record<string, unknown>;
  incidentEdges: CachedIncidentEdge[];
  memberIds: string[];
}

export class GraphViewportController {
  private readonly datasetId: string;
  private layoutVersion?: string | null;
  private readonly client: GraphViewportClientDependency;
  private readonly graph: Graph;
  private sigma: SigmaViewportLike;
  private readonly debounceMs: number;
  private readonly maxNodes: number;
  private readonly lodTierCount: number;
  private readonly smallTreeThreshold: number;
  private readonly preparedNodeCount: number | null;
  private readonly getPaused?: () => boolean;
  private readonly onViewportLoaded?: (response: GraphViewportResponse) => void;
  private readonly onError?: (error: unknown) => void;
  private readonly getRenderSettings?: () => ViewportSyncSettings;
  private readonly onGraphSynced?: (response?: GraphViewportResponse) => void;
  private debounceTimer: ReturnType<typeof window.setTimeout> | null = null;
  private initialFitTimer: ReturnType<typeof window.setTimeout> | null = null;
  private requestSequence = 0;
  private mounted = false;
  private loadedInitialViewport = false;
  private lastRequestedLodLevel: number | null | undefined;
  private nextForcedLodLevel: number | undefined;
  private fitNextResponse = false;
  private suppressCameraRefreshUntil = 0;
  // Total node count reported by the current viewport response. At coarse LoD
  // levels this can be the number of representatives in that tier, not the raw
  // tree node count, so it is only a small-tree signal once the finest tier is
  // loaded or no prepared node count is available.
  private totalNodeCount: number | null = null;
  // Clusters currently expanded into their members via a click. Tracked so a
  // double-click can collapse them back without a server round-trip.
  private readonly expandedClusterIds = new Set<string>();
  // Snapshot captured at expand time so collapse can restore the cluster
  // proxy exactly: the representative node (id + attributes) and the edges
  // that were incident to it before expansion replaced it with members.
  private readonly expandedClusterCache = new Map<string, ExpandedClusterSnapshot>();
  private readonly cameraUpdated = () => this.scheduleViewportRefreshForCamera();
  private readonly nodeClicked = (payload: { node?: string; event?: { node?: string } }) => {
    void this.expandClusterFromClick(payload);
  };
  private readonly nodeDoubleClicked = (payload: { node?: string; event?: { node?: string } }) => {
    this.collapseClusterFromDoubleClick(payload);
  };

  constructor(options: GraphViewportControllerOptions) {
    this.datasetId = options.datasetId;
    this.layoutVersion = options.layoutVersion;
    this.client = options.client;
    this.graph = options.graph;
    this.sigma = options.sigma as SigmaViewportLike;
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
  }

  mount(): void {
    if (this.mounted) {
      return;
    }
    this.mounted = true;
    this.bindSigmaEvents();
    this.scheduleViewportRefresh(0);
  }

  // Re-attach camera/click handlers to a Sigma instance the renderer rebuilt
  // (e.g. to register piechart programs). The previous instance has already
  // been killed by the renderer, so only the new instance needs binding.
  rebindSigma(sigma: SigmaViewportLike): void {
    if (sigma === this.sigma) {
      return;
    }
    this.sigma = sigma;
    if (this.mounted) {
      this.bindSigmaEvents();
    }
  }

  private bindSigmaEvents(): void {
    const camera = this.sigma.getCamera();
    camera.off?.("updated", this.cameraUpdated);
    camera.on?.("updated", this.cameraUpdated);
    this.sigma.off?.("clickNode", this.nodeClicked);
    this.sigma.on?.("clickNode", this.nodeClicked);
    this.sigma.off?.("doubleClickNode", this.nodeDoubleClicked);
    this.sigma.on?.("doubleClickNode", this.nodeDoubleClicked);
  }

  private unbindSigmaEvents(): void {
    this.sigma.getCamera().off?.("updated", this.cameraUpdated);
    this.sigma.off?.("clickNode", this.nodeClicked);
    this.sigma.off?.("doubleClickNode", this.nodeDoubleClicked);
  }

  unmount(): void {
    if (!this.mounted) {
      return;
    }
    this.mounted = false;
    this.unbindSigmaEvents();
    if (this.debounceTimer !== null) {
      window.clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.initialFitTimer !== null) {
      window.clearTimeout(this.initialFitTimer);
      this.initialFitTimer = null;
    }
    this.requestSequence += 1;
  }

  refreshNow(options: GraphViewportRefreshOptions = {}): void {
    if (options.lodLevel === "finest") {
      this.nextForcedLodLevel = Math.max(this.lodTierCount - 1, 0);
    } else if (typeof options.lodLevel === "number" && Number.isFinite(options.lodLevel)) {
      this.nextForcedLodLevel = Math.min(Math.max(Math.round(options.lodLevel), 0), Math.max(this.lodTierCount - 1, 0));
    }
    this.fitNextResponse = options.fitToResponse === true;
    this.scheduleViewportRefresh(0);
  }

  setLayoutVersion(layoutVersion: string | null | undefined): void {
    this.layoutVersion = layoutVersion;
    this.scheduleViewportRefresh(0);
  }

  expandCluster(clusterId: string, options: { fitToResponse?: boolean; focusNodeId?: string | null } = {}): void {
    if (!clusterId) {
      return;
    }
    void this.loadCluster(clusterId, options);
  }

  private scheduleViewportRefreshForCamera(): void {
    // Frozen while LOD playback is paused: camera movement pans over the
    // existing geometry without fetching a new slice. refreshNow() (invoked on
    // resume) bypasses this guard to reconcile to the current view.
    if (this.getPaused?.()) {
      return;
    }
    if (Date.now() < this.suppressCameraRefreshUntil) {
      return;
    }
    // A small tree is loaded whole at the finest tier on first paint, so there
    // is nothing further to fetch: freeze it entirely and let the camera pan and
    // zoom over the fixed geometry without any server round-trips.
    if (this.isSmallTreeLoaded()) {
      return;
    }
    const nextLodLevel = this.currentLodLevel();
    const lodChanged = this.loadedInitialViewport && nextLodLevel !== this.lastRequestedLodLevel;
    // At LOD 0 the query carries no bounds (a fixed global overview), so a
    // same-tier pan would refetch the identical slice; skip it. At finer tiers
    // the query is bounds-driven, so a pan shifts the visible region and must
    // refetch to reveal nodes the camera moved onto. The debounce collapses a
    // burst of pan events into a single query, and no refetch moves the camera,
    // so exploration stays smooth without jumps or a flood of requests.
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

  // Whether the tree is known (from the prepare response, before the first
  // viewport load) to fit whole in the client. Drives the finest-tier initial
  // load so a small tree opens as individual nodes, not the triangle overview.
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
    // A small tree always renders the finest tier whole (all nodes, no cluster
    // proxies), never the triangle overview. This holds on every load, not just
    // the first: refreshes triggered by a visual-mapping change, layout-version
    // change, or LOD-playback resume must keep it frozen at individual nodes
    // rather than snapping back to the tier-0 overview. isKnownSmallTree covers
    // the first load (from the prepare node count); isSmallTreeLoaded covers
    // every subsequent load (from the loaded total_node_count).
    const finestTier = this.isKnownSmallTree() || this.isSmallTreeLoaded();
    const forcedLodLevel = this.nextForcedLodLevel;
    const fitResponse = this.fitNextResponse;
    this.nextForcedLodLevel = undefined;
    this.fitNextResponse = false;
    const query = buildGraphViewportQuery({
      datasetId: this.datasetId,
      layoutVersion: this.layoutVersion,
      sigma: this.sigma,
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
      const settings = this.getRenderSettings?.();
      syncGraphologyViewport(this.graph, response, settings);
      reconcileGraphologyViewport(this.graph, response, settings);
      this.onGraphSynced?.(response);
      if (fitResponse) {
        this.suppressCameraRefreshUntil = Date.now() + GRAPH_VIEWER_INITIAL_FIT_DURATION_MS + this.debounceMs;
        this.initialFitTimer = fitSigmaToViewportResponse(this.sigma, response, { resetFirst: false });
      }
      // Fit the camera to the initial load whether it was the global overview
      // (tier 0) or a small tree's whole finest-tier render, so both frame the
      // full graph on first paint.
      if (!fitResponse && !this.loadedInitialViewport && (query.lod_level === 0 || finestTier)) {
        this.initialFitTimer = fitSigmaToViewportResponse(this.sigma, response);
      }
      this.loadedInitialViewport = true;
      this.sigma.refresh?.();
      this.sigma.scheduleRender?.();
      this.onViewportLoaded?.(response);
    } catch (error) {
      if (!this.mounted || sequence !== this.requestSequence) {
        return;
      }
      this.onError?.(error);
    }
  }

  private async expandClusterFromClick(payload: { node?: string; event?: { node?: string } }): Promise<void> {
    const nodeId =
      typeof payload.node === "string"
        ? payload.node
        : typeof payload.event?.node === "string"
          ? payload.event.node
          : undefined;
    if (!nodeId || !this.graph.hasNode(nodeId)) {
      return;
    }

    const attributes = this.graph.getNodeAttributes(nodeId) as Record<string, unknown>;
    if (!isExpandableRepresentative(attributes)) {
      return;
    }

    const clusterId = typeof attributes.cluster_id === "string" ? attributes.cluster_id : nodeId;
    // Snapshot the proxy (representative node + its incident edges) before the
    // expansion overwrites it, so a later double-click can collapse it back
    // without re-querying the server.
    const snapshot = this.captureClusterSnapshot(nodeId, attributes);
    const sequence = ++this.requestSequence;
    try {
      const response = await this.readCluster(clusterId);
      if (!this.mounted || sequence !== this.requestSequence) {
        return;
      }
      this.layoutVersion = response.layout_version;
      syncGraphologyViewport(this.graph, response, this.getRenderSettings?.());
      snapshot.memberIds = response.nodes.filter((node) => !node.is_representative).map((node) => node.id);
      this.expandedClusterCache.set(clusterId, snapshot);
      this.expandedClusterIds.add(clusterId);
      this.onGraphSynced?.(response);
      // Expanding a cluster adds its members in place; the camera is left
      // untouched so the surrounding graph stays visible and the user can keep
      // expanding additional clusters up to the node budget without the view
      // snapping to a single expanded region.
      this.sigma.refresh?.();
      this.sigma.scheduleRender?.();
      this.onViewportLoaded?.(response);
    } catch (error) {
      if (!this.mounted || sequence !== this.requestSequence) {
        return;
      }
      this.onError?.(error);
    }
  }

  private async loadCluster(
    clusterId: string,
    options: { fitToResponse?: boolean; focusNodeId?: string | null },
  ): Promise<void> {
    const sequence = ++this.requestSequence;
    try {
      const response = await this.readCluster(clusterId, options.focusNodeId);
      if (!this.mounted || sequence !== this.requestSequence) {
        return;
      }
      this.layoutVersion = response.layout_version;
      syncGraphologyViewport(this.graph, response, this.getRenderSettings?.());
      this.onGraphSynced?.(response);
      if (options.fitToResponse) {
        this.suppressCameraRefreshUntil = Date.now() + GRAPH_VIEWER_INITIAL_FIT_DURATION_MS + this.debounceMs;
        this.initialFitTimer = fitSigmaToViewportResponse(this.sigma, response, { resetFirst: false });
      }
      this.sigma.refresh?.();
      this.sigma.scheduleRender?.();
      this.onViewportLoaded?.(response);
    } catch (error) {
      if (!this.mounted || sequence !== this.requestSequence) {
        return;
      }
      this.onError?.(error);
    }
  }

  private readCluster(clusterId: string, focusNodeId?: string | null): Promise<GraphViewportResponse> {
    return this.client.readViewport({
      dataset_id: this.datasetId,
      layout_version: this.layoutVersion ?? null,
      cluster_id: clusterId,
      focus_node_id: focusNodeId ?? null,
      zoom: sigmaDisplayZoom(this.sigma.getCamera()),
      lod_level: null,
      max_nodes: this.maxNodes,
    });
  }

  // Capture the representative node and its incident edges so collapse can
  // rebuild the proxy verbatim. Edge attributes are shallow-copied because
  // graphology returns live references.
  private captureClusterSnapshot(
    representativeId: string,
    representativeAttributes: Record<string, unknown>,
  ): ExpandedClusterSnapshot {
    const incidentEdges: CachedIncidentEdge[] = this.graph.edges(representativeId).map((edgeId) => ({
      id: edgeId,
      source: this.graph.source(edgeId),
      target: this.graph.target(edgeId),
      attributes: {
        ...(this.graph.getEdgeAttributes(edgeId) as Record<string, unknown>),
      },
    }));
    return {
      representativeId,
      representativeAttributes: { ...representativeAttributes },
      incidentEdges,
      memberIds: [],
    };
  }

  private collapseClusterFromDoubleClick(payload: { node?: string; event?: { node?: string } }): void {
    const nodeId =
      typeof payload.node === "string"
        ? payload.node
        : typeof payload.event?.node === "string"
          ? payload.event.node
          : undefined;
    if (!nodeId || !this.graph.hasNode(nodeId)) {
      return;
    }
    const attributes = this.graph.getNodeAttributes(nodeId) as Record<string, unknown>;
    const clusterId = typeof attributes.cluster_id === "string" ? attributes.cluster_id : nodeId;
    this.collapseCluster(clusterId);
  }

  // Restore a previously expanded cluster to its proxy from cache. No server
  // round-trip: drops the member nodes, re-adds the representative node, and
  // restores the edges that were incident to it. A no-op for clusters that
  // were never expanded (or already collapsed).
  collapseCluster(clusterId: string): void {
    const snapshot = this.expandedClusterCache.get(clusterId);
    if (!snapshot) {
      return;
    }

    // Drop the expanded members. The representative is re-added afterwards, so
    // dropping it here too (when it doubled as a member medoid) is fine.
    for (const memberId of snapshot.memberIds) {
      if (this.graph.hasNode(memberId)) {
        this.graph.dropNode(memberId);
      }
    }
    if (this.graph.hasNode(snapshot.representativeId)) {
      this.graph.dropNode(snapshot.representativeId);
    }

    this.graph.addNode(snapshot.representativeId, {
      ...snapshot.representativeAttributes,
    });
    for (const edge of snapshot.incidentEdges) {
      if (!this.graph.hasNode(edge.source) || !this.graph.hasNode(edge.target) || this.graph.hasEdge(edge.id)) {
        continue;
      }
      this.graph.addEdgeWithKey(edge.id, edge.source, edge.target, {
        ...edge.attributes,
      });
    }

    this.expandedClusterCache.delete(clusterId);
    this.expandedClusterIds.delete(clusterId);
    this.onGraphSynced?.();
    this.sigma.refresh?.();
    this.sigma.scheduleRender?.();
  }

  private currentLodLevel(): number | null {
    return (
      buildGraphViewportQuery({
        datasetId: this.datasetId,
        layoutVersion: this.layoutVersion,
        sigma: this.sigma,
        maxNodes: this.maxNodes,
        forceGlobal: !this.loadedInitialViewport,
        lodTierCount: this.lodTierCount,
        currentLodLevel: this.lastRequestedLodLevel ?? null,
      }).lod_level ?? null
    );
  }
}
