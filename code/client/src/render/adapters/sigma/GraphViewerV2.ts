import type Graph from "graphology";

import type {
  GraphV2Client,
  GraphV2ViewportResponse,
} from "../../../api/graphV2Client";
import {
  buildGraphV2ViewportQuery,
  DEFAULT_GRAPH_VIEWER_V2_DEBOUNCE_MS,
  DEFAULT_GRAPH_VIEWER_V2_MAX_NODES,
  sigmaDisplayZoom,
} from "./graphViewerV2Query";
import {
  fitSigmaToClusterResponse,
  fitSigmaToViewportResponse,
} from "./graphViewerV2Fit";
import {
  isExpandableRepresentative,
  reconcileGraphologyViewport,
  syncGraphologyViewport,
} from "./graphViewerV2Sync";
import type { ViewportSyncSettings } from "./graphViewerV2Sync";
import type { SigmaViewportLike } from "./graphViewerV2Types";

export {
  buildGraphV2ViewportQuery,
  DEFAULT_GRAPH_VIEWER_V2_DEBOUNCE_MS,
  DEFAULT_GRAPH_VIEWER_V2_MAX_NODES,
  expandViewportBounds,
  GRAPH_VIEWER_V2_DETAIL_RATIO_THRESHOLD,
  GRAPH_VIEWER_V2_VIEWPORT_PADDING_RATIO,
  semanticLodLevelForCameraRatio,
  sigmaViewportBounds,
} from "./graphViewerV2Query";
export {
  fitSigmaToClusterResponse,
  fitSigmaToViewportResponse,
  GRAPH_VIEWER_V2_CLUSTER_FIT_DURATION_MS,
  GRAPH_VIEWER_V2_CLUSTER_FIT_PADDING_RATIO,
  GRAPH_VIEWER_V2_FIT_PADDING_RATIO,
  GRAPH_VIEWER_V2_INITIAL_FIT_DELAY_MS,
  GRAPH_VIEWER_V2_INITIAL_FIT_DURATION_MS,
} from "./graphViewerV2Fit";
export {
  DEFAULT_GRAPH_VIEWER_V2_NODE_SIZE,
  GRAPH_VIEWER_V2_EDGE_COLOR,
  GRAPH_VIEWER_V2_MAX_MEMBER_SIZE_BOOST,
  GRAPH_VIEWER_V2_MEMBER_SIZE_FACTOR,
  GRAPH_VIEWER_V2_NODE_COLOR,
  GRAPH_VIEWER_V2_REPRESENTATIVE_COLOR,
  nodeSizeForMemberCount,
  reconcileGraphologyViewport,
  syncGraphologyViewport,
} from "./graphViewerV2Sync";
export type { ViewportSyncSettings } from "./graphViewerV2Sync";
export type { SigmaViewportBounds } from "./graphViewerV2Types";

export interface GraphViewerV2Options {
  datasetId: string;
  layoutVersion?: string | null;
  client: GraphV2Client;
  graph: Graph;
  sigma: SigmaViewportLike;
  debounceMs?: number;
  maxNodes?: number;
  onViewportLoaded?: (response: GraphV2ViewportResponse) => void;
  onError?: (error: unknown) => void;
  getRenderSettings?: () => ViewportSyncSettings;
  // Fires after each viewport sync writes into the graph but before Sigma
  // refreshes, letting the renderer register piechart programs / flip node
  // types (and rebind this viewer via rebindSigma) while attributes are fresh.
  onGraphSynced?: () => void;
}

export class GraphViewerV2 {
  private readonly datasetId: string;
  private layoutVersion?: string | null;
  private readonly client: GraphV2Client;
  private readonly graph: Graph;
  private sigma: SigmaViewportLike;
  private readonly debounceMs: number;
  private readonly maxNodes: number;
  private readonly onViewportLoaded?: (
    response: GraphV2ViewportResponse,
  ) => void;
  private readonly onError?: (error: unknown) => void;
  private readonly getRenderSettings?: () => ViewportSyncSettings;
  private readonly onGraphSynced?: () => void;
  private debounceTimer: ReturnType<typeof window.setTimeout> | null = null;
  private initialFitTimer: ReturnType<typeof window.setTimeout> | null = null;
  private requestSequence = 0;
  private mounted = false;
  private loadedInitialViewport = false;
  private lastRequestedLodLevel: number | null | undefined;
  private readonly cameraUpdated = () =>
    this.scheduleViewportRefreshForCamera();
  private readonly nodeClicked = (payload: {
    node?: string;
    event?: { node?: string };
  }) => {
    void this.expandClusterFromClick(payload);
  };

  constructor(options: GraphViewerV2Options) {
    this.datasetId = options.datasetId;
    this.layoutVersion = options.layoutVersion;
    this.client = options.client;
    this.graph = options.graph;
    this.sigma = options.sigma as SigmaViewportLike;
    this.debounceMs = options.debounceMs ?? DEFAULT_GRAPH_VIEWER_V2_DEBOUNCE_MS;
    this.maxNodes = options.maxNodes ?? DEFAULT_GRAPH_VIEWER_V2_MAX_NODES;
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
  }

  private unbindSigmaEvents(): void {
    this.sigma.getCamera().off?.("updated", this.cameraUpdated);
    this.sigma.off?.("clickNode", this.nodeClicked);
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

  refreshNow(): void {
    this.scheduleViewportRefresh(0);
  }

  setLayoutVersion(layoutVersion: string | null | undefined): void {
    this.layoutVersion = layoutVersion;
    this.scheduleViewportRefresh(0);
  }

  private scheduleViewportRefreshForCamera(): void {
    const nextLodLevel = this.currentLodLevel();
    const lodChanged =
      this.loadedInitialViewport && nextLodLevel !== this.lastRequestedLodLevel;
    this.scheduleViewportRefresh(lodChanged ? 0 : this.debounceMs);
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
    const query = buildGraphV2ViewportQuery({
      datasetId: this.datasetId,
      layoutVersion: this.layoutVersion,
      sigma: this.sigma,
      maxNodes: this.maxNodes,
      forceGlobal: !this.loadedInitialViewport,
    });
    this.lastRequestedLodLevel = query.lod_level;

    try {
      const response = await this.client.readViewport(query);
      if (!this.mounted || sequence !== this.requestSequence) {
        return;
      }
      this.layoutVersion = response.layout_version;
      const settings = this.getRenderSettings?.();
      syncGraphologyViewport(this.graph, response, settings);
      reconcileGraphologyViewport(this.graph, response, settings);
      this.onGraphSynced?.();
      if (!this.loadedInitialViewport && query.lod_level === 0) {
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

  private async expandClusterFromClick(payload: {
    node?: string;
    event?: { node?: string };
  }): Promise<void> {
    const nodeId =
      typeof payload.node === "string"
        ? payload.node
        : typeof payload.event?.node === "string"
          ? payload.event.node
          : undefined;
    if (!nodeId || !this.graph.hasNode(nodeId)) {
      return;
    }

    const attributes = this.graph.getNodeAttributes(nodeId) as Record<
      string,
      unknown
    >;
    if (!isExpandableRepresentative(attributes)) {
      return;
    }

    const clusterId =
      typeof attributes.cluster_id === "string"
        ? attributes.cluster_id
        : nodeId;
    const sequence = ++this.requestSequence;
    try {
      const response = await this.client.readViewport({
        dataset_id: this.datasetId,
        layout_version: this.layoutVersion ?? null,
        cluster_id: clusterId,
        zoom: sigmaDisplayZoom(this.sigma.getCamera()),
        lod_level: null,
        max_nodes: this.maxNodes,
      });
      if (!this.mounted || sequence !== this.requestSequence) {
        return;
      }
      this.layoutVersion = response.layout_version;
      syncGraphologyViewport(this.graph, response, this.getRenderSettings?.());
      this.onGraphSynced?.();
      fitSigmaToClusterResponse(this.sigma, response);
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

  private currentLodLevel(): number | null {
    return (
      buildGraphV2ViewportQuery({
        datasetId: this.datasetId,
        layoutVersion: this.layoutVersion,
        sigma: this.sigma,
        maxNodes: this.maxNodes,
        forceGlobal: !this.loadedInitialViewport,
      }).lod_level ?? null
    );
  }
}
