import Graph from "graphology";
import type Sigma from "sigma";

import type {
  GraphV2Client,
  GraphV2ViewportEdge,
  GraphV2ViewportNode,
  GraphV2ViewportQuery,
  GraphV2ViewportResponse,
} from "../../../api/graphV2Client";
import {
  PHYLOVIZ_NODE_COMMON_COLOR,
  SIGMA_NODE_TYPE_TRIANGLE,
} from "./sigmaRenderingConstants";

export const DEFAULT_GRAPH_VIEWER_V2_DEBOUNCE_MS = 250;
export const DEFAULT_GRAPH_VIEWER_V2_MAX_NODES = 2_500;
export const DEFAULT_GRAPH_VIEWER_V2_NODE_SIZE = 5;
export const GRAPH_VIEWER_V2_MEMBER_SIZE_FACTOR = 1.25;
export const GRAPH_VIEWER_V2_MAX_MEMBER_SIZE_BOOST = 6;
export const GRAPH_VIEWER_V2_VIEWPORT_PADDING_RATIO = 0.5;
export const GRAPH_VIEWER_V2_FIT_PADDING_RATIO = 1.15;
export const GRAPH_VIEWER_V2_INITIAL_FIT_DELAY_MS = 50;
export const GRAPH_VIEWER_V2_INITIAL_FIT_DURATION_MS = 300;
export const GRAPH_VIEWER_V2_CLUSTER_FIT_PADDING_RATIO = 1.35;
export const GRAPH_VIEWER_V2_CLUSTER_FIT_DURATION_MS = 350;
export const GRAPH_VIEWER_V2_DETAIL_RATIO_THRESHOLD = 0.8;
export const GRAPH_VIEWER_V2_REPRESENTATIVE_COLOR = "#b45309";
export const GRAPH_VIEWER_V2_NODE_COLOR = PHYLOVIZ_NODE_COMMON_COLOR;
export const GRAPH_VIEWER_V2_EDGE_COLOR = "#94a3b8";

export interface GraphViewerV2Options {
  datasetId: string;
  layoutVersion?: string | null;
  client: GraphV2Client;
  graph: Graph;
  sigma: Sigma;
  debounceMs?: number;
  maxNodes?: number;
  onViewportLoaded?: (response: GraphV2ViewportResponse) => void;
  onError?: (error: unknown) => void;
}

export interface SigmaViewportBounds {
  xmin: number;
  xmax: number;
  ymin: number;
  ymax: number;
}

type SigmaCameraLike = {
  on?: (event: "updated", handler: () => void) => void;
  off?: (event: "updated", handler: () => void) => void;
  getState?: () => { x?: number; y?: number; ratio?: number };
  animatedReset?: (options?: { duration?: number }) => void;
  animate?: (
    state: { x: number; y: number; ratio: number },
    options?: { duration?: number },
  ) => void;
  ratio?: number;
};

type SigmaViewportLike = Sigma & {
  on?: (
    event: "clickNode",
    handler: (payload: { node?: string; event?: { node?: string } }) => void,
  ) => void;
  off?: (
    event: "clickNode",
    handler: (payload: { node?: string; event?: { node?: string } }) => void,
  ) => void;
  getCamera: () => SigmaCameraLike;
  getDimensions?: () => { width: number; height: number };
  getContainer?: () => HTMLElement;
  viewportToGraph: (point: { x: number; y: number }) => {
    x: number;
    y: number;
  };
  refresh?: () => void;
  scheduleRender?: () => void;
};

export class GraphViewerV2 {
  private readonly datasetId: string;
  private layoutVersion?: string | null;
  private readonly client: GraphV2Client;
  private readonly graph: Graph;
  private readonly sigma: SigmaViewportLike;
  private readonly debounceMs: number;
  private readonly maxNodes: number;
  private readonly onViewportLoaded?: (
    response: GraphV2ViewportResponse,
  ) => void;
  private readonly onError?: (error: unknown) => void;
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
  }

  mount(): void {
    if (this.mounted) {
      return;
    }
    this.mounted = true;
    this.sigma.getCamera().on?.("updated", this.cameraUpdated);
    this.sigma.on?.("clickNode", this.nodeClicked);
    this.scheduleViewportRefresh(0);
  }

  unmount(): void {
    if (!this.mounted) {
      return;
    }
    this.mounted = false;
    this.sigma.getCamera().off?.("updated", this.cameraUpdated);
    this.sigma.off?.("clickNode", this.nodeClicked);
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
      syncGraphologyViewport(this.graph, response);
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
      syncGraphologyViewport(this.graph, response);
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

export function buildGraphV2ViewportQuery({
  datasetId,
  layoutVersion,
  sigma,
  maxNodes,
  forceGlobal = false,
}: {
  datasetId: string;
  layoutVersion?: string | null;
  sigma: SigmaViewportLike;
  maxNodes: number;
  forceGlobal?: boolean;
}): GraphV2ViewportQuery {
  const ratio = sigmaCameraRatio(sigma.getCamera());
  const viewportBounds = sigmaViewportBounds(sigma);
  const lodLevel = forceGlobal ? 0 : semanticLodLevelForCameraRatio(ratio);
  const bounds =
    lodLevel === 0
      ? null
      : expandViewportBounds(
          viewportBounds,
          GRAPH_VIEWER_V2_VIEWPORT_PADDING_RATIO,
        );

  const query: GraphV2ViewportQuery = {
    dataset_id: datasetId,
    layout_version: layoutVersion ?? null,
    zoom: sigmaRatioToDisplayZoom(ratio),
    lod_level: lodLevel,
    max_nodes: maxNodes,
  };
  if (bounds) {
    query.xmin = bounds.xmin;
    query.xmax = bounds.xmax;
    query.ymin = bounds.ymin;
    query.ymax = bounds.ymax;
  }
  return query;
}

export function sigmaViewportBounds(
  sigma: SigmaViewportLike,
): SigmaViewportBounds {
  const dimensions = sigmaDimensions(sigma);
  const corners = [
    sigma.viewportToGraph({ x: 0, y: 0 }),
    sigma.viewportToGraph({ x: dimensions.width, y: 0 }),
    sigma.viewportToGraph({ x: 0, y: dimensions.height }),
    sigma.viewportToGraph({ x: dimensions.width, y: dimensions.height }),
  ];
  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);

  return {
    xmin: Math.min(...xs),
    xmax: Math.max(...xs),
    ymin: Math.min(...ys),
    ymax: Math.max(...ys),
  };
}

export function semanticLodLevelForCameraRatio(ratio: number): number {
  if (!Number.isFinite(ratio) || ratio <= 0) {
    return 1;
  }
  return ratio < GRAPH_VIEWER_V2_DETAIL_RATIO_THRESHOLD ? 1 : 0;
}

export function expandViewportBounds(
  bounds: SigmaViewportBounds,
  paddingRatio: number,
): SigmaViewportBounds {
  const width = bounds.xmax - bounds.xmin;
  const height = bounds.ymax - bounds.ymin;
  const xPadding = width * paddingRatio;
  const yPadding = height * paddingRatio;
  return {
    xmin: bounds.xmin - xPadding,
    xmax: bounds.xmax + xPadding,
    ymin: bounds.ymin - yPadding,
    ymax: bounds.ymax + yPadding,
  };
}

export function syncGraphologyViewport(
  graph: Graph,
  response: GraphV2ViewportResponse,
): void {
  response.nodes.forEach((node) => upsertGraphNode(graph, node));
  response.edges.forEach((edge) => upsertGraphEdge(graph, edge));
}

export function fitSigmaToViewportResponse(
  sigma: SigmaViewportLike,
  response: GraphV2ViewportResponse,
): ReturnType<typeof window.setTimeout> | null {
  if (response.nodes.length === 0) {
    return null;
  }
  sigma.refresh?.();
  const dimensions = sigmaDimensions(sigma);
  const xs = response.nodes.map((node) => node.x);
  const ys = response.nodes.map((node) => node.y);
  const width = Math.max(Math.max(...xs) - Math.min(...xs), 1);
  const height = Math.max(Math.max(...ys) - Math.min(...ys), 1);
  const ratio =
    Math.max(
      width / Math.max(dimensions.width, 1),
      height / Math.max(dimensions.height, 1),
    ) * GRAPH_VIEWER_V2_FIT_PADDING_RATIO;

  const camera = sigma.getCamera();

  return window.setTimeout(() => {
    sigma.refresh?.();
    if (camera.animatedReset) {
      camera.animatedReset({
        duration: GRAPH_VIEWER_V2_INITIAL_FIT_DURATION_MS,
      });
      window.setTimeout(() => {
        const state = camera.getState?.();
        if (!state || typeof state.ratio !== "number" || !camera.animate) {
          return;
        }
        camera.animate(
          {
            x: state.x ?? (Math.min(...xs) + Math.max(...xs)) / 2,
            y: state.y ?? (Math.min(...ys) + Math.max(...ys)) / 2,
            ratio: Math.max(
              state.ratio * GRAPH_VIEWER_V2_FIT_PADDING_RATIO,
              Number.EPSILON,
            ),
          },
          { duration: 100 },
        );
      }, GRAPH_VIEWER_V2_INITIAL_FIT_DURATION_MS);
      return;
    }
    camera.animate?.(
      {
        x: (Math.min(...xs) + Math.max(...xs)) / 2,
        y: (Math.min(...ys) + Math.max(...ys)) / 2,
        ratio: Math.max(ratio, Number.EPSILON),
      },
      { duration: GRAPH_VIEWER_V2_INITIAL_FIT_DURATION_MS },
    );
  }, GRAPH_VIEWER_V2_INITIAL_FIT_DELAY_MS);
}

export function fitSigmaToClusterResponse(
  sigma: SigmaViewportLike,
  response: GraphV2ViewportResponse,
): void {
  if (response.nodes.length === 0) {
    return;
  }
  const dimensions = sigmaDimensions(sigma);
  const bounds = responseBounds(response);
  const width = Math.max(bounds.xmax - bounds.xmin, 1);
  const height = Math.max(bounds.ymax - bounds.ymin, 1);
  const ratio =
    Math.max(
      width / Math.max(dimensions.width, 1),
      height / Math.max(dimensions.height, 1),
    ) * GRAPH_VIEWER_V2_CLUSTER_FIT_PADDING_RATIO;
  sigma.getCamera().animate?.(
    {
      x: (bounds.xmin + bounds.xmax) / 2,
      y: (bounds.ymin + bounds.ymax) / 2,
      ratio: Math.max(ratio, Number.EPSILON),
    },
    { duration: GRAPH_VIEWER_V2_CLUSTER_FIT_DURATION_MS },
  );
}

function upsertGraphNode(graph: Graph, node: GraphV2ViewportNode): void {
  const attributes = graphNodeAttributes(node);
  if (!graph.hasNode(node.id)) {
    graph.addNode(node.id, attributes);
    return;
  }

  Object.entries(attributes).forEach(([key, value]) => {
    graph.setNodeAttribute(node.id, key, value);
  });
}

function upsertGraphEdge(graph: Graph, edge: GraphV2ViewportEdge): void {
  if (!graph.hasNode(edge.source) || !graph.hasNode(edge.target)) {
    return;
  }
  const attributes = graphEdgeAttributes(edge);
  if (!graph.hasEdge(edge.id)) {
    graph.addEdgeWithKey(edge.id, edge.source, edge.target, attributes);
    return;
  }
  Object.entries(attributes).forEach(([key, value]) => {
    graph.setEdgeAttribute(edge.id, key, value);
  });
}

function graphNodeAttributes(
  node: GraphV2ViewportNode,
): Record<string, unknown> {
  const isRepresentative = node.is_representative || node.member_count > 1;
  return {
    x: node.x,
    y: node.y,
    size: nodeSizeForMemberCount(node.member_count),
    label: node.is_representative ? "" : node.id,
    color: isRepresentative
      ? GRAPH_VIEWER_V2_REPRESENTATIVE_COLOR
      : GRAPH_VIEWER_V2_NODE_COLOR,
    cluster_id: node.cluster_id,
    member_count: node.member_count,
    is_cluster_proxy: isRepresentative || undefined,
    type: isRepresentative ? SIGMA_NODE_TYPE_TRIANGLE : undefined,
    layout_status: node.layout_status,
  };
}

function isExpandableRepresentative(
  attributes: Record<string, unknown>,
): boolean {
  return (
    attributes.type === SIGMA_NODE_TYPE_TRIANGLE ||
    attributes.is_cluster_proxy === true ||
    (typeof attributes.member_count === "number" && attributes.member_count > 1)
  );
}

function responseBounds(
  response: GraphV2ViewportResponse,
): SigmaViewportBounds {
  const xs = response.nodes.map((node) => node.x);
  const ys = response.nodes.map((node) => node.y);
  return {
    xmin: Math.min(...xs),
    xmax: Math.max(...xs),
    ymin: Math.min(...ys),
    ymax: Math.max(...ys),
  };
}

function graphEdgeAttributes(
  edge: GraphV2ViewportEdge,
): Record<string, unknown> {
  return {
    color: GRAPH_VIEWER_V2_EDGE_COLOR,
    size: 1,
    distance: edge.distance ?? undefined,
    label:
      typeof edge.distance === "number" && Number.isFinite(edge.distance)
        ? String(edge.distance)
        : "",
  };
}

export function nodeSizeForMemberCount(memberCount: number): number {
  const safeMemberCount = Math.max(1, memberCount);
  const boost = Math.min(
    GRAPH_VIEWER_V2_MAX_MEMBER_SIZE_BOOST,
    (Math.sqrt(safeMemberCount) - 1) * GRAPH_VIEWER_V2_MEMBER_SIZE_FACTOR,
  );
  return DEFAULT_GRAPH_VIEWER_V2_NODE_SIZE + boost;
}

function sigmaCameraRatio(camera: SigmaCameraLike): number {
  const state = camera.getState?.() ?? camera;
  return typeof state.ratio === "number" && Number.isFinite(state.ratio)
    ? state.ratio
    : 1;
}

function sigmaDisplayZoom(camera: SigmaCameraLike): number {
  return sigmaRatioToDisplayZoom(sigmaCameraRatio(camera));
}

function sigmaRatioToDisplayZoom(ratio: number): number {
  return 1 / Math.max(ratio, Number.EPSILON);
}

function sigmaDimensions(sigma: SigmaViewportLike): {
  width: number;
  height: number;
} {
  const dimensions = sigma.getDimensions?.();
  if (dimensions) {
    return dimensions;
  }
  const rect = sigma.getContainer?.().getBoundingClientRect();
  return {
    width: rect?.width ?? 1,
    height: rect?.height ?? 1,
  };
}
