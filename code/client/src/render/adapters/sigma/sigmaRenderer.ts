import Graph from "graphology";
import Sigma from "sigma";

import type { GraphClient } from "../../../api/graphClient";
import type { GraphViewportResponse } from "../../../api/graphContracts";
import type { PositionedGraph } from "../../../contracts/positioned";
import { RENDERER_KIND_SIGMA } from "../../types";
import type {
  GraphDisplayOptions,
  GraphRenderer,
  RenderContext,
  RenderNodeClickState,
  RendererKind,
  RenderViewportState,
} from "../../types";
import { detectPieSliceKeys, PIE_ATTRIBUTE_PREFIX } from "../../pieMapping";
import {
  defaultCameraState,
  deriveGraphBounds,
  type GraphBounds,
  normalizeGraphBounds,
  type SigmaSemanticViewState,
  sigmaCameraToSemanticViewState,
} from "./sigmaCamera";
import sigmaBoxSelectController from "./sigmaBoxSelectController";
import sigmaDragController from "./sigmaDragController";
import createSigmaForceMotion from "./sigmaForceMotion";
import {
  SIGMA_REGION_DIMMED_EDGE_COLOR,
  SIGMA_REGION_DIMMED_NODE_COLOR,
} from "./sigmaRenderingConstants";
import type { SigmaViewportBounds } from "./graphViewerTypes";
import {
  addPositionedEdges,
  addPositionedNode,
  applyPieChartNodeTypes,
  areStringArraysEqual,
  buildPieProgramSignature,
  buildSigmaSettings,
  type PieNodeView,
  piechartProgramClasses,
  type SigmaPiechartOptions,
  type SigmaRendererOptions,
} from "./sigmaNodeRendering";
import {
  applyStableCameraBounds,
  centerCameraOnCoordinates,
  centerCameraOnGraphNode,
  readCameraState,
  restoreCameraState,
} from "./sigmaRendererCameraState";
import { GraphViewer } from "./GraphViewer";
import type { ViewportSyncSettings } from "./graphViewerSync";

export {
  SIGMA_DEFAULT_CAMERA_ZOOM,
  SIGMA_MAX_LOD_ZOOM,
  sigmaCameraToViewportState,
  sigmaCameraToSemanticViewState,
  sigmaRatioToLodZoom,
} from "./sigmaCamera";
export type { SigmaPiechartOptions, SigmaRendererOptions };

export const ERR_CONTAINER_NOT_FOUND =
  "Sigma container not found: {containerId}";
export const ERR_SIGMA_NOT_READY = "Sigma renderer is not mounted.";

// Sigma renderer adapter keeps Sigma-specific behavior isolated from core contracts.
export class SigmaRenderer implements GraphRenderer {
  readonly kind: RendererKind = RENDERER_KIND_SIGMA;

  private graph: Graph | null = null;
  private sigma: Sigma | null = null;
  private containerElement: HTMLElement | null = null;
  private pieSliceKeys: string[] = [];
  private pieProgramSignature = "";
  private graphBounds: GraphBounds | null = null;
  private coordinateBounds: GraphBounds | null = null;
  private piechartOptions: SigmaPiechartOptions;
  private rendererOptions: SigmaRendererOptions;
  private readonly dragController: ReturnType<typeof sigmaDragController>;
  private readonly boxSelectController: ReturnType<
    typeof sigmaBoxSelectController
  >;
  private readonly forceMotion: ReturnType<typeof createSigmaForceMotion>;
  private graphViewer: GraphViewer | null = null;
  private viewChangeHandler: ((state: RenderViewportState) => void) | null =
    null;
  private nodeClickHandler: ((state: RenderNodeClickState) => void) | null =
    null;
  private regionSelectModeEnabled = false;
  private regionSelectedHandler:
    | ((bounds: SigmaViewportBounds) => void)
    | null = null;
  private highlightedNodeIds: ReadonlySet<string> | null = null;
  private suppressViewChangesUntil = 0;
  // One-shot guard: swallows exactly the next view-change emission caused by a
  // programmatic camera move (e.g. focusing a search result), then re-enables
  // immediately so user panning is never blocked by a time window.
  private suppressNextViewChange = false;
  private suppressNodeClicksUntil = 0;
  private lastRenderedGraph: PositionedGraph | null = null;
  private selectedNodeId: string | null = null;
  private readonly boundCameraUpdated = () => {
    this.handleCameraUpdated();
  };
  private readonly boundNodeClicked = (payload: {
    node?: string;
    event?: { node?: string };
  }) => {
    this.emitNodeClick(payload);
  };

  constructor(options: SigmaRendererOptions = {}) {
    this.rendererOptions = options;
    this.piechartOptions = options.piechart ?? {};
    this.forceMotion = createSigmaForceMotion(options.forceMotion, {
      onTick: () => this.updateClusterTriangleRotations(),
    });
    this.dragController = sigmaDragController({
      getGraph: () => this.graph,
      getSigma: () => this.sigma,
      suppressViewChangesFor: (durationMs) =>
        this.suppressViewChangesFor(durationMs),
      suppressNodeClicksFor: (durationMs) =>
        this.suppressNodeClicksFor(durationMs),
    });
    this.boxSelectController = sigmaBoxSelectController({
      getSigma: () => this.sigma,
      getContainer: () => this.containerElement,
      isModeEnabled: () => this.regionSelectModeEnabled,
      onRegionSelected: (bounds) => this.regionSelectedHandler?.(bounds),
      suppressNodeClicksFor: (durationMs) =>
        this.suppressNodeClicksFor(durationMs),
    });
  }

  // Bind the renderer adapter to a view container.
  mount(context: RenderContext): void {
    const container = document.getElementById(context.containerId);
    if (!container) {
      throw new Error(
        ERR_CONTAINER_NOT_FOUND.replace("{containerId}", context.containerId),
      );
    }

    this.containerElement = container;
    this.graph = new Graph();
    this.sigma = new Sigma(
      this.graph,
      this.containerElement,
      buildSigmaSettings(this.rendererOptions),
    );
    this.sigma.getCamera().setState(defaultCameraState());
    this.bindSigmaHandlers();
  }

  // Render positioned nodes and edges into Graphology then refresh Sigma.
  render(graph: PositionedGraph): void {
    if (!this.graph || !this.sigma) {
      throw new Error(ERR_SIGMA_NOT_READY);
    }

    // Clear previous frame first so Sigma rebuilds never see stale piechart nodes.
    this.stopGraphViewportSync();
    this.forceMotion.stop();
    this.lastRenderedGraph = graph;
    this.graph.clear();
    this.graphBounds = deriveGraphBounds(graph.nodes);
    this.coordinateBounds =
      normalizeGraphBounds(graph.viewMeta.globalBounds) ?? this.graphBounds;
    this.ensureSigmaPiePrograms(graph);
    applyStableCameraBounds(this.sigma, this.coordinateBounds);

    graph.nodes.forEach((positionedNode) => {
      addPositionedNode(
        this.graph as Graph,
        positionedNode,
        this.pieSliceKeys,
        this.rendererOptions,
        this.selectedNodeId,
      );
    });
    addPositionedEdges(this.graph, graph, this.rendererOptions);
    this.updateClusterTriangleRotations();
    this.sigma.refresh();
    this.forceMotion.start(this.graph, graph);
    this.updateEdgeLabelVisibility(this.readSemanticViewState());
  }

  setViewChangeHandler(
    handler: ((state: RenderViewportState) => void) | null,
  ): void {
    this.viewChangeHandler = handler;
  }

  setNodeClickHandler(
    handler: ((state: RenderNodeClickState) => void) | null,
  ): void {
    this.nodeClickHandler = handler;
  }

  centerOnNode(nodeId: string): boolean {
    if (
      !centerCameraOnGraphNode({
        graph: this.graph,
        sigma: this.sigma,
        coordinateBounds: this.coordinateBounds,
        nodeId,
        // Swallow only the single programmatic camera move; user panning stays
        // responsive immediately afterward (no time window).
        beforeSetState: () => {
          this.suppressNextViewChange = true;
        },
      })
    ) {
      return false;
    }

    this.selectedNodeId = nodeId;
    this.renderSelectedNodeState();
    return true;
  }

  // Move the camera to raw graph coordinates without requiring the node to be
  // in the rendered graph. Used by search focus so a node outside the current
  // LoD slice can be centered; a subsequent viewport re-fetch pulls in its
  // slice, where the node then renders as the selected (red) node.
  centerOnCoordinates(x: number, y: number): boolean {
    return centerCameraOnCoordinates({
      sigma: this.sigma,
      coordinateBounds: this.coordinateBounds,
      x,
      y,
      beforeSetState: () => {
        this.suppressNextViewChange = true;
      },
    });
  }

  focusNode(nodeId: string | null): void {
    this.selectedNodeId = nodeId;
    this.renderSelectedNodeState();
  }

  updateDisplayOptions(displayOptions: GraphDisplayOptions): void {
    this.rendererOptions = {
      ...this.rendererOptions,
      display: {
        ...this.rendererOptions.display,
        ...displayOptions,
      },
    };

    if (this.sigma) {
      this.rebuildSigma(this.pieSliceKeys, this.lastRenderedGraph?.nodes ?? []);
    }
  }

  // Drop container and graph references when renderer is detached.
  unmount(): void {
    this.stopGraphViewportSync();
    this.forceMotion.stop();
    this.unbindSigmaHandlers();
    this.sigma?.kill();
    this.sigma = null;
    this.graph = null;
    this.containerElement = null;
    this.pieSliceKeys = [];
    this.pieProgramSignature = "";
    this.graphBounds = null;
    this.coordinateBounds = null;
    this.lastRenderedGraph = null;
    this.selectedNodeId = null;
    this.highlightedNodeIds = null;
    this.dragController.reset();
    this.boxSelectController.reset();
  }

  startGraphViewportSync(options: {
    client: GraphClient;
    datasetId: string;
    layoutVersion?: string | null;
    maxNodes?: number;
    lodTierCount?: number;
    nodeCount?: number | null;
    getPaused?: () => boolean;
    onViewportLoaded?: (response: GraphViewportResponse) => void;
    onError?: (error: unknown) => void;
    getRenderSettings?: () => ViewportSyncSettings;
  }): void {
    if (!this.graph || !this.sigma) {
      throw new Error(ERR_SIGMA_NOT_READY);
    }

    this.forceMotion.stop();
    this.graph.clear();
    this.graphViewer?.unmount();
    this.graphViewer = new GraphViewer({
      datasetId: options.datasetId,
      layoutVersion: options.layoutVersion,
      client: options.client,
      graph: this.graph,
      sigma: this.sigma,
      maxNodes: options.maxNodes,
      lodTierCount: options.lodTierCount,
      nodeCount: options.nodeCount,
      getPaused: options.getPaused,
      onViewportLoaded: options.onViewportLoaded,
      onError: options.onError,
      getRenderSettings: options.getRenderSettings,
      onGraphSynced: () => this.syncPieProgramsFromGraph(),
    });
    this.graphViewer.mount();
  }

  stopGraphViewportSync(): void {
    this.graphViewer?.unmount();
    this.graphViewer = null;
  }

  refreshGraphViewportSync(): void {
    this.graphViewer?.refreshNow();
  }

  setRegionSelectModeEnabled(enabled: boolean): void {
    this.regionSelectModeEnabled = enabled;
  }

  setRegionSelectedHandler(
    handler: ((bounds: SigmaViewportBounds) => void) | null,
  ): void {
    this.regionSelectedHandler = handler;
  }

  // Dim every node/edge outside `nodeIds` so the selected region stands out.
  // An empty set or null clears the highlight and repaints at full opacity.
  setHighlightedNodes(nodeIds: ReadonlySet<string> | null): void {
    this.highlightedNodeIds =
      nodeIds && nodeIds.size > 0 ? nodeIds : null;
    this.applyHighlightReducers();
    this.sigma?.scheduleRender?.();
  }

  // Install node/edge reducers that grey out anything outside the active
  // highlight set. Reinstalled after every Sigma rebuild via bindSigmaHandlers
  // so the highlight survives piechart-program registration.
  private applyHighlightReducers(): void {
    const sigma = this.sigma;
    if (!sigma) {
      return;
    }

    const highlighted = this.highlightedNodeIds;
    if (!highlighted) {
      sigma.setSetting("nodeReducer", null);
      sigma.setSetting("edgeReducer", null);
      return;
    }

    sigma.setSetting("nodeReducer", (nodeId, data) =>
      highlighted.has(nodeId)
        ? data
        : { ...data, color: SIGMA_REGION_DIMMED_NODE_COLOR, label: "" },
    );
    sigma.setSetting("edgeReducer", (edgeId, data) => {
      const source = this.graph?.source(edgeId);
      const target = this.graph?.target(edgeId);
      const withinRegion =
        source !== undefined &&
        target !== undefined &&
        highlighted.has(source) &&
        highlighted.has(target);
      return withinRegion
        ? data
        : { ...data, color: SIGMA_REGION_DIMMED_EDGE_COLOR };
    });
  }

  // Register piechart programs for the live LoD graph and flip pie nodes to the
  // piechart type once the program exists. Invoked after each viewport sync via
  // GraphViewer's onGraphSynced hook, before Sigma refreshes. Mirrors the
  // legacy ensureSigmaPiePrograms flow but reads slice keys from the graphology
  // graph (sync writes attributes directly rather than via addPositionedNode).
  private syncPieProgramsFromGraph(): void {
    if (!this.graph || !this.sigma || !this.containerElement) {
      return;
    }

    // Bail before materializing node views when pies are off (the default),
    // so a disabled-pie session does no O(N) work per viewport sync. The one
    // remaining cost is a single teardown when leaving an enabled state.
    if (this.piechartOptions.enabled === false) {
      if (this.pieSliceKeys.length > 0) {
        this.rebuildSigma([], []);
      }
      return;
    }

    // Pie mapping is opt-in via `pie__*` node attributes rather than an explicit
    // flag (the renderer is constructed with no piechart options), so `enabled`
    // is normally `undefined` and the guard above never fires. Probe the live
    // graph cheaply first: `findNode` short-circuits on the first pie-bearing
    // node, so a plain role-color slice with N nodes costs O(1)-O(k) instead of
    // the full O(N) graphNodeViews + detect + signature scan on every sync. When
    // no pie attributes are present and no pie program is registered, there is
    // nothing to do; if a program is registered but pies have since vanished,
    // tear it down once.
    if (!this.graphHasPieAttributes()) {
      if (this.pieSliceKeys.length > 0) {
        this.rebuildSigma([], []);
      }
      return;
    }

    const nodeViews = graphNodeViews(this.graph);
    const detectedSliceKeys = detectPieSliceKeys(nodeViews);
    const nextSignature = buildPieProgramSignature(detectedSliceKeys, nodeViews);
    if (
      !areStringArraysEqual(this.pieSliceKeys, detectedSliceKeys) ||
      this.pieProgramSignature !== nextSignature
    ) {
      try {
        this.rebuildSigma(detectedSliceKeys, nodeViews, nextSignature);
      } catch (error) {
        console.warn(
          "Failed to build Sigma piechart program; falling back to default nodes.",
          {
            sliceCount: detectedSliceKeys.length,
            sliceKeys: detectedSliceKeys,
            error,
          },
        );
        this.rebuildSigma([], [], "");
      }
    }

    applyPieChartNodeTypes(this.graph, this.pieSliceKeys);
  }

  // Cheap probe: does any live node carry a `pie__*` attribute? `findNode`
  // returns on the first match, so a slice with no pie mapping active pays only
  // for the scan up to the first node rather than materializing every node view.
  private graphHasPieAttributes(): boolean {
    if (!this.graph) {
      return false;
    }
    return (
      this.graph.findNode((_nodeId, attributes) =>
        Object.keys(attributes).some((key) =>
          key.startsWith(PIE_ATTRIBUTE_PREFIX),
        ),
      ) !== undefined
    );
  }

  private suppressViewChangesFor(durationMs: number): void {
    this.suppressViewChangesUntil = Date.now() + durationMs;
  }

  private suppressNodeClicksFor(durationMs: number): void {
    this.suppressNodeClicksUntil = Date.now() + durationMs;
  }

  private ensureSigmaPiePrograms(graph: PositionedGraph): void {
    if (!this.graph || !this.containerElement) {
      throw new Error(ERR_SIGMA_NOT_READY);
    }

    if (this.piechartOptions.enabled === false) {
      if (this.pieSliceKeys.length > 0) {
        this.rebuildSigma([]);
      }
      return;
    }

    const detectedSliceKeys = detectPieSliceKeys(graph.nodes);
    const nextSignature = buildPieProgramSignature(
      detectedSliceKeys,
      graph.nodes,
    );
    if (
      !areStringArraysEqual(this.pieSliceKeys, detectedSliceKeys) ||
      this.pieProgramSignature !== nextSignature
    ) {
      try {
        this.rebuildSigma(detectedSliceKeys, graph.nodes, nextSignature);
      } catch (error) {
        console.warn(
          "Failed to build Sigma piechart program; falling back to default nodes.",
          {
            sliceCount: detectedSliceKeys.length,
            sliceKeys: detectedSliceKeys,
            error,
          },
        );
        this.rebuildSigma([], [], "");
      }
    }
  }

  private rebuildSigma(
    sliceKeys: string[],
    nodes: readonly PieNodeView[] = [],
    signature = buildPieProgramSignature(sliceKeys, nodes),
  ): void {
    const previousCameraState = readCameraState(this.sigma);
    const previousSigma = this.sigma;
    const sigmaSettings = buildSigmaSettings(
      this.rendererOptions,
      piechartProgramClasses(sliceKeys, nodes, this.piechartOptions),
    );

    this.unbindSigmaHandlers();
    previousSigma?.kill();
    this.sigma = new Sigma(
      this.graph as Graph,
      this.containerElement as HTMLElement,
      sigmaSettings,
    );
    this.pieSliceKeys = sliceKeys;
    this.pieProgramSignature = signature;
    restoreCameraState(this.sigma, previousCameraState);
    this.bindSigmaHandlers();
    // Keep the live LoD viewer bound to the rebuilt instance so its camera and
    // click handlers survive program registration. No-op in the render() path,
    // where viewport sync is stopped before any rebuild.
    this.graphViewer?.rebindSigma(this.sigma);
  }

  private bindSigmaHandlers(): void {
    this.bindCameraHandler();
    this.bindNodeClickHandler();
    this.dragController.bind();
    this.boxSelectController.bind();
    this.applyHighlightReducers();
  }

  private unbindSigmaHandlers(): void {
    this.boxSelectController.unbind();
    this.dragController.unbind();
    this.unbindNodeClickHandler();
    this.unbindCameraHandler();
  }

  private bindCameraHandler(): void {
    const camera = this.sigma?.getCamera() as
      | {
          on?: (event: string, handler: () => void) => void;
          off?: (event: string, handler: () => void) => void;
        }
      | undefined;
    camera?.off?.("updated", this.boundCameraUpdated);
    camera?.on?.("updated", this.boundCameraUpdated);
  }

  private bindNodeClickHandler(): void {
    const sigma = this.sigma as {
      on?: (
        event: string,
        handler: (payload: {
          node?: string;
          event?: { node?: string };
        }) => void,
      ) => void;
      off?: (
        event: string,
        handler: (payload: {
          node?: string;
          event?: { node?: string };
        }) => void,
      ) => void;
    } | null;
    sigma?.off?.("clickNode", this.boundNodeClicked);
    sigma?.on?.("clickNode", this.boundNodeClicked);
  }

  private unbindCameraHandler(): void {
    const camera = this.sigma?.getCamera() as
      | {
          off?: (event: string, handler: () => void) => void;
        }
      | undefined;
    camera?.off?.("updated", this.boundCameraUpdated);
  }

  private unbindNodeClickHandler(): void {
    const sigma = this.sigma as {
      off?: (
        event: string,
        handler: (payload: {
          node?: string;
          event?: { node?: string };
        }) => void,
      ) => void;
    } | null;
    sigma?.off?.("clickNode", this.boundNodeClicked);
  }

  private handleCameraUpdated(): void {
    const viewState = this.readSemanticViewState();
    this.updateEdgeLabelVisibility(viewState);
    this.emitViewChange(viewState);
  }

  private readSemanticViewState(): SigmaSemanticViewState | null {
    if (!this.sigma || !this.coordinateBounds) {
      return null;
    }

    const camera = this.sigma.getCamera() as {
      x?: number;
      y?: number;
      ratio?: number;
      getState?: () => { x?: number; y?: number; ratio?: number };
    };
    return sigmaCameraToSemanticViewState(
      this.coordinateBounds,
      camera.getState?.() ?? camera,
    );
  }

  private emitViewChange(viewState: SigmaSemanticViewState | null): void {
    if (this.suppressNextViewChange) {
      this.suppressNextViewChange = false;
      return;
    }
    if (Date.now() < this.suppressViewChangesUntil) {
      return;
    }

    if (!this.viewChangeHandler || !this.containerElement || !viewState) {
      return;
    }

    this.viewChangeHandler({
      viewport: viewState.viewport,
      zoom: viewState.lodZoom,
    });
  }

  private updateEdgeLabelVisibility(
    viewState: SigmaSemanticViewState | null,
  ): void {
    if (!this.sigma || !viewState) {
      return;
    }

    const shouldRender =
      this.rendererOptions.display?.edgeDistanceLabels === true &&
      viewState.edgeDistanceLabelsVisible;

    if (this.sigma.getSetting("renderEdgeLabels") !== shouldRender) {
      this.sigma.setSetting("renderEdgeLabels", shouldRender);
      this.sigma.scheduleRender();
    }
  }

  private emitNodeClick(payload: {
    node?: string;
    event?: { node?: string };
  }): void {
    if (Date.now() < this.suppressNodeClicksUntil) {
      return;
    }

    if (!this.nodeClickHandler || !this.graph) {
      return;
    }

    const nodeId =
      typeof payload.node === "string"
        ? payload.node
        : typeof payload.event?.node === "string"
          ? payload.event.node
          : undefined;
    if (!nodeId || !this.graph.hasNode(nodeId)) {
      return;
    }

    this.selectedNodeId = nodeId;
    this.renderSelectedNodeState();
    this.nodeClickHandler({
      nodeId,
      attributes: this.graph.getNodeAttributes(nodeId) as Record<
        string,
        unknown
      >,
    });
  }

  private renderSelectedNodeState(): void {
    if (!this.lastRenderedGraph) {
      return;
    }

    this.render(this.lastRenderedGraph);
  }

  private updateClusterTriangleRotations(): void {
    if (!this.graph || !this.lastRenderedGraph) {
      return;
    }

    applyClusterTriangleRotations(this.graph, this.lastRenderedGraph.edges);
    this.sigma?.scheduleRender();
  }
}

// Project the live graphology graph into the node-attribute views the pie
// helpers consume, matching the shape produced by the legacy positioned graph.
function graphNodeViews(graph: Graph): PieNodeView[] {
  return graph.mapNodes((_nodeId, attributes) => ({
    attributes: attributes as Record<string, unknown>,
  }));
}

function applyClusterTriangleRotations(
  graph: Graph,
  edges: PositionedGraph["edges"],
): void {
  edges.forEach((edge) => {
    if (!graph.hasNode(edge.source) || !graph.hasNode(edge.target)) {
      return;
    }

    const source = graph.getNodeAttributes(edge.source);
    const target = graph.getNodeAttributes(edge.target);

    if (source.is_cluster_proxy === true) {
      graph.setNodeAttribute(
        edge.source,
        "triangleRotation",
        Math.atan2(
          Number(target.y) - Number(source.y),
          Number(target.x) - Number(source.x),
        ),
      );
    }
    if (target.is_cluster_proxy === true) {
      graph.setNodeAttribute(
        edge.target,
        "triangleRotation",
        Math.atan2(
          Number(source.y) - Number(target.y),
          Number(source.x) - Number(target.x),
        ),
      );
    }
  });
}
