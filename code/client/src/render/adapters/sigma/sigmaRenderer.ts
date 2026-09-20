import { DisplayPositions, type Point } from "./motion/displayPositions";
import type { DragSelection } from "../../renderer.types";
import { exportSigmaPublication } from "./sigmaPublicationExport";
import Graph from "graphology";
import Sigma from "sigma";

import type { PositionedGraph } from "../../../contracts/positioned";
import { RENDERER_KIND_SIGMA } from "../../renderer.types";
import type {
  GraphDisplayOptions,
  PngExportOptions,
  GraphRenderer,
  RenderContext,
  RenderInteractiveAggregateTarget,
  RenderNodeClickState,
  RenderViewportBounds,
  RenderViewportSyncState,
  RendererKind,
  RenderViewportState,
} from "../../renderer.types";
import { detectPieSliceKeys, PIE_ATTRIBUTE_PREFIX } from "../../mapping/pieMapping";
import {
  defaultCameraState,
  deriveGraphBounds,
  type GraphBounds,
  normalizeGraphBounds,
  type SigmaSemanticViewState,
  sigmaCameraToSemanticViewState,
} from "./camera/sigmaCamera";
import sigmaBoxSelectController from "./interaction/sigmaBoxSelectController";
import sigmaDragController from "./interaction/sigmaDragController";
import applySigmaHighlighting from "./interaction/sigmaHighlighting";
import createSigmaForceMotion from "./motion/sigmaForceMotion";
import { areStringArraysEqual } from "./attributes/sigmaAttributeUtils";
import { addPositionedEdges } from "./attributes/sigmaEdgeAttributes";
import { addPositionedNode, applyPieChartNodeTypes, derivePositionedNodeColor } from "./attributes/sigmaNodeAttributes";
import { buildPieProgramSignature, piechartProgramClasses, type PieNodeView } from "./programs/sigmaPiePrograms";
import { buildSigmaSettings } from "./sigmaRenderer.settings";
import type { SigmaPiechartOptions, SigmaRendererOptions } from "./sigmaRenderer.types";
import {
  applyStableCameraBounds,
  centerCameraOnCoordinates,
  centerCameraOnGraphNode,
  readCameraState,
  restoreCameraState,
} from "./camera/sigmaCameraState";
import { fitSigmaToGraphSnapshot } from "./viewport/graphViewportFit";
import { exportCanvasLayersAsPng } from "../../export/canvasExport";
import { PHYLOVIZ_NODE_SELECTED_COLOR, SIGMA_NODE_TYPE_TRIANGLE } from "./sigmaRendering.constants";

export {
  SIGMA_DEFAULT_CAMERA_ZOOM,
  SIGMA_MAX_LOD_ZOOM,
  sigmaCameraToViewportState,
  sigmaCameraToSemanticViewState,
  sigmaRatioToLodZoom,
} from "./camera/sigmaCamera";
export type { SigmaPiechartOptions, SigmaRendererOptions };

export const ERR_SIGMA_NOT_READY = "Sigma renderer is not mounted.";

// Sigma renderer adapter keeps Sigma-specific behavior isolated from core contracts.
export class SigmaRenderer implements GraphRenderer {
  readonly kind: RendererKind = RENDERER_KIND_SIGMA;

  private cancelFit: (() => void) | null = null;
  private readonly cancelCameraFit = () => {
    this.cancelFit?.();
    this.cancelFit = null;
  };
  private graph: Graph | null = null;
  private dragSelection: DragSelection = { kind: "node" };
  private readonly positions = new DisplayPositions();
  private readonly dragPins = new Map<string, Point>();
  private manipulationHandler: ((active: boolean) => void) | null = null;
  private feedbackHandler: ((message: string) => void) | null = null;
  private transitioning = false;
  private selectingRegion = false;
  private transitionFrame: number | null = null;
  private zoomPointer: Point | null = null;
  private transitionAnchor: { ids: string[]; screen: Point } | null = null;
  private readonly trackZoomPointer = (event: WheelEvent) => {
    const rect = this.containerElement?.getBoundingClientRect();
    if (rect) this.zoomPointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    if (this.transitioning) {
      this.captureDisplayPositions();
      this.cancelTransition();
      this.finishManipulation();
    }
  };
  private pendingSnapshot: { graph: PositionedGraph; options?: { preservePositions?: boolean } } | null = null;

  setMotionEnabled(enabled: boolean): void {
    this.forceMotion.setEnabled(enabled);
  }
  isMotionEnabled(): boolean {
    return this.forceMotion.isEnabled();
  }
  setInteractionFeedbackHandler(handler: ((message: string) => void) | null): void {
    this.feedbackHandler = handler;
  }
  setManipulationHandler(handler: ((active: boolean) => void) | null): void {
    this.manipulationHandler = handler;
  }
  isManipulating(): boolean {
    return this.dragPins.size > 0 || this.transitioning || this.selectingRegion;
  }
  getVisibleDisplacedNodeIds(): readonly string[] {
    const bounds = this.currentViewportBounds();
    return this.getDisplayedNodesInBounds(bounds).filter((id) => {
      const home = this.positions.reference(id),
        display = this.positions.get(id);
      return home && display && Math.hypot(home.x - display.x, home.y - display.y) > 1e-9;
    });
  }
  getDisplayedNodesInBounds(bounds: RenderViewportBounds): readonly string[] {
    return (
      this.graph?.filterNodes(
        (_id, a) => a.x >= bounds.xmin && a.x <= bounds.xmax && a.y >= bounds.ymin && a.y <= bounds.ymax,
      ) ?? []
    );
  }
  private captureDisplayPositions(): void {
    this.graph?.forEachNode((id, attributes) => this.positions.set(id, { x: attributes.x, y: attributes.y }));
  }

  private sendDragPins(): void {
    this.forceMotion.setPins([...this.dragPins].map(([id, point]) => ({ id, ...point })));
  }

  private finishManipulation(): void {
    const pending = this.pendingSnapshot;
    this.pendingSnapshot = null;
    if (pending) this.applyGraphSnapshot(pending.graph, pending.options);
    this.manipulationHandler?.(this.isManipulating());
  }
  private cancelTransition(): void {
    if (this.transitionFrame !== null) cancelAnimationFrame(this.transitionFrame);
    this.transitionFrame = null;
    this.transitionAnchor = null;
    this.transitioning = false;
    this.forceMotion.suspend(false);
  }

  private sourceSnapshot: PositionedGraph | null = null;

  setDragSelection(selection: DragSelection): void {
    this.dragController.reset();
    this.dragSelection =
      selection.kind === "group" ? { ...selection, nodeIds: [...selection.nodeIds] } : { ...selection };
  }

  resetLayoutEdits(): void {
    this.pendingSnapshot = null;
    this.setMotionEnabled(false);
    this.cancelTransition();
    this.dragController.reset();
    this.positions.clear();
    this.dragSelection = { kind: "node" };
    if (this.sourceSnapshot && this.sigma) this.applyGraphSnapshot(this.sourceSnapshot, { preservePositions: false });
    this.manipulationHandler?.(false);
  }

  private sigma: Sigma | null = null;
  private containerElement: HTMLElement | null = null;
  private pieSliceKeys: string[] = [];
  private pieProgramSignature = "";
  private graphBounds: GraphBounds | null = null;
  private coordinateBounds: GraphBounds | null = null;
  private piechartOptions: SigmaPiechartOptions;
  private rendererOptions: SigmaRendererOptions;
  private readonly dragController: ReturnType<typeof sigmaDragController>;
  private readonly boxSelectController: ReturnType<typeof sigmaBoxSelectController>;
  private readonly forceMotion: ReturnType<typeof createSigmaForceMotion>;
  private viewChangeHandler: ((state: RenderViewportState) => void) | null = null;
  private nodeClickHandler: ((state: RenderNodeClickState) => void) | null = null;
  private nodeDoubleClickHandler: ((state: RenderNodeClickState) => void) | null = null;
  private regionSelectModeEnabled = false;
  private regionSelectedHandler: ((bounds: RenderViewportBounds) => void) | null = null;
  private highlightedNodeIds: ReadonlySet<string> | null = null;
  private suppressViewChangesUntil = 0;
  // One-shot guard: swallows exactly the next view-change emission caused by a
  // programmatic camera move (e.g. focusing a search result), then re-enables
  // immediately so user panning is never blocked by a time window.
  private suppressNextViewChange = false;
  private suppressNodeClicksUntil = 0;
  private lastRenderedGraph: PositionedGraph | null = null;
  private selectedNodeId: string | null = null;
  private selectedClusterStyle: { id: string; color: unknown; size: unknown } | null = null;
  private readonly boundCameraUpdated = () => {
    this.handleCameraUpdated();
  };
  private readonly boundNodeClicked = (payload: { node?: string; event?: { node?: string } }) => {
    this.emitNodeClick(payload);
  };
  private readonly boundNodeDoubleClicked = (payload: { node?: string; event?: { node?: string } }) => {
    this.emitNodeDoubleClick(payload);
  };
  private readonly boundStageClicked = () => {
    this.clearNodeSelection();
  };

  constructor(options: SigmaRendererOptions = {}) {
    this.rendererOptions = options;
    this.piechartOptions = options.piechart ?? {};
    this.forceMotion = createSigmaForceMotion(options.forceMotion, {
      onTick: () => this.updateClusterTriangleRotations(),
      onError: (message) => this.feedbackHandler?.(message),
      reference: (id) => this.positions.reference(id),
      anchor: (id) => this.positions.anchor(id),
      constrain: (id, point) => this.positions.set(id, this.dragPins.get(id) ?? point),
    });
    this.dragController = sigmaDragController({
      getGraph: () => this.graph,
      getSelection: () => this.dragSelection,
      isRegionSelectionEnabled: () => this.regionSelectModeEnabled,
      onStart: (ids) => {
        this.cancelCameraFit();
        this.captureDisplayPositions();
        this.cancelTransition();
        ids.forEach((id) => this.dragPins.set(id, this.positions.get(id)!));
        this.sendDragPins();
        this.manipulationHandler?.(true);
      },
      translate: (members, delta) => this.positions.translate(members, delta),
      onUnavailable: (message) => this.feedbackHandler?.(message),
      onMoved: (positions) => {
        positions.forEach((point, id) => this.dragPins.set(id, this.positions.arrange(id, point)));
        this.sendDragPins();
      },
      onEnd: () => {
        const released = [...this.dragPins].map(([id, point]) => ({ id, ...point }));
        this.dragPins.clear();
        this.forceMotion.setPins([], released);
        this.finishManipulation();
      },
      getSigma: () => this.sigma,
      suppressViewChangesFor: (durationMs) => this.suppressViewChangesFor(durationMs),
      suppressNodeClicksFor: (durationMs) => this.suppressNodeClicksFor(durationMs),
    });
    this.boxSelectController = sigmaBoxSelectController({
      getSigma: () => this.sigma,
      getContainer: () => this.containerElement,
      isModeEnabled: () => this.regionSelectModeEnabled,
      onStart: () => {
        this.cancelCameraFit();
        this.captureDisplayPositions();
        this.cancelTransition();
        this.selectingRegion = true;
        this.forceMotion.suspend(true);
        this.manipulationHandler?.(true);
      },
      onEnd: () => {
        this.selectingRegion = false;
        this.forceMotion.suspend(false);
        this.finishManipulation();
      },
      onRegionSelected: (bounds) => this.regionSelectedHandler?.(bounds),
      suppressNodeClicksFor: (durationMs) => this.suppressNodeClicksFor(durationMs),
    });
  }

  // Bind the renderer adapter to a view container.
  mount(context: RenderContext): void {
    this.containerElement = context.container;
    this.graph = new Graph();
    this.sigma = new Sigma(this.graph, this.containerElement, buildSigmaSettings(this.rendererOptions));
    this.sigma.getCamera().setState(defaultCameraState());
    this.bindSigmaHandlers();
  }

  // Render positioned nodes and edges into Graphology then refresh Sigma.
  render(graph: PositionedGraph): void {
    if (!this.graph || !this.sigma) {
      throw new Error(ERR_SIGMA_NOT_READY);
    }

    this.cancelTransition();
    this.dragController.reset();
    this.sourceSnapshot = graph;
    this.positions.clear();
    this.forceMotion.stop();
    this.lastRenderedGraph = graph;
    this.graph.clear();
    this.graphBounds = deriveGraphBounds(graph.nodes);
    this.coordinateBounds = normalizeGraphBounds(graph.viewMeta.globalBounds) ?? this.graphBounds;
    this.ensureSigmaPiePrograms(graph);
    applyStableCameraBounds(this.sigma, this.coordinateBounds);

    graph.nodes.forEach((positionedNode) => {
      addPositionedNode(this.graph as Graph, positionedNode, this.pieSliceKeys, this.rendererOptions);
    });
    addPositionedEdges(this.graph, graph, this.rendererOptions);
    this.updateClusterTriangleRotations();
    this.sigma.refresh();
    this.positions.ingest(graph);
    this.forceMotion.start(this.graph);
    this.updateEdgeLabelVisibility(this.readSemanticViewState());
  }

  setViewChangeHandler(handler: ((state: RenderViewportState) => void) | null): void {
    this.viewChangeHandler = handler;
  }

  setNodeClickHandler(handler: ((state: RenderNodeClickState) => void) | null): void {
    this.nodeClickHandler = handler;
  }

  setNodeDoubleClickHandler(handler: ((state: RenderNodeClickState) => void) | null): void {
    this.nodeDoubleClickHandler = handler;
  }

  centerOnNode(nodeId: string): boolean {
    if (
      !centerCameraOnGraphNode({
        graph: this.graph,
        sigma: this.sigma,
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
    this.applyHighlighting();
    this.sigma?.scheduleRender?.();
    return true;
  }

  // Move the camera to raw graph coordinates without requiring the node to be
  // in the rendered graph. Used by search focus so a node outside the current
  // LoD slice can be centered; a subsequent viewport re-fetch pulls in its
  // slice, where the node then renders as the selected (red) node.
  centerOnCoordinates(x: number, y: number): boolean {
    return centerCameraOnCoordinates({
      sigma: this.sigma,
      x,
      y,
      beforeSetState: () => {
        this.suppressNextViewChange = true;
      },
    });
  }

  focusNode(nodeId: string | null): void {
    this.selectedNodeId = nodeId;
    this.applyHighlighting();
    this.sigma?.scheduleRender?.();
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
      this.sigma.setSetting(
        "renderLabels",
        this.rendererOptions.label?.enabled !== false && this.rendererOptions.display?.nodeLabels !== false,
      );
      this.updateEdgeLabelVisibility(this.readSemanticViewState());
    }
  }

  exportPng(options?: PngExportOptions): Promise<Blob> {
    if (!this.containerElement) {
      throw new Error(ERR_SIGMA_NOT_READY);
    }
    if (options && this.sigma && this.graph && this.lastRenderedGraph)
      return exportSigmaPublication(this.sigma, this.graph, this.lastRenderedGraph, this.rendererOptions, options);
    this.sigma?.refresh();
    return exportCanvasLayersAsPng(this.containerElement.querySelectorAll("canvas"));
  }

  // Drop container and graph references when renderer is detached.
  unmount(): void {
    this.cancelTransition();
    this.forceMotion.dispose();
    this.pendingSnapshot = null;
    this.manipulationHandler = null;
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
    this.sourceSnapshot = null;
    this.positions.clear();
    this.dragSelection = { kind: "node" };
    this.selectedNodeId = null;
    this.selectedClusterStyle = null;
    this.highlightedNodeIds = null;
    this.dragController.reset();
    this.boxSelectController.reset();
  }

  setRegionSelectModeEnabled(enabled: boolean): void {
    this.regionSelectModeEnabled = enabled;
  }

  setRegionSelectedHandler(handler: ((bounds: RenderViewportBounds) => void) | null): void {
    this.regionSelectedHandler = handler;
  }

  getViewportSyncState(): RenderViewportSyncState | null {
    if (!this.sigma) {
      return null;
    }
    const bounds = this.currentViewportBounds();
    const halo = this.positions.queryPadding();
    return {
      bounds: {
        xmin: bounds.xmin - halo.x,
        xmax: bounds.xmax + halo.x,
        ymin: bounds.ymin - halo.y,
        ymax: bounds.ymax + halo.y,
      },
      cameraRatio: this.currentCameraRatio(),
    };
  }

  applyGraphSnapshot(graph: PositionedGraph, options?: { preservePositions?: boolean }): void {
    if (!this.graph || !this.sigma) {
      throw new Error(ERR_SIGMA_NOT_READY);
    }

    if (this.dragPins.size || this.selectingRegion) {
      this.pendingSnapshot = { graph, options };
      return;
    }
    const wasTransitioning = this.transitioning;
    this.cancelTransition();
    this.forceMotion.stop();
    const previousLod = this.sourceSnapshot?.viewMeta.lodLevel;
    const previousPositions = new Map<string, Point>();
    this.graph.forEachNode((id, a) => {
      const point = { x: a.x, y: a.y };
      previousPositions.set(id, point);
      if (options?.preservePositions) this.positions.set(id, point);
    });
    this.sourceSnapshot = graph;
    const planned = this.positions.ingest(graph);
    graph = { ...graph, nodes: planned.nodes };
    const lodChanged = previousLod !== undefined && previousLod !== graph.viewMeta.lodLevel;
    const targets = new Map(graph.nodes.map((node) => [node.id, { x: node.x, y: node.y }]));
    this.transitionAnchor = lodChanged ? this.chooseTransitionAnchor(graph) : null;
    if (wasTransitioning || lodChanged || planned.origins.size) {
      graph = {
        ...graph,
        nodes: graph.nodes.map((node) => ({
          ...node,
          ...this.positions.constrain(node.id, planned.origins.get(node.id) ?? previousPositions.get(node.id) ?? node),
        })),
      };
    }
    const cameraState = readCameraState(this.sigma);
    const previousCoordinateBounds = this.coordinateBounds;
    this.lastRenderedGraph = graph;
    this.selectedClusterStyle = null;
    this.graph.clear();
    this.graphBounds = deriveGraphBounds(graph.nodes);
    this.coordinateBounds = normalizeGraphBounds(graph.viewMeta.globalBounds) ?? this.graphBounds;
    if (!graphBoundsEqual(previousCoordinateBounds, this.coordinateBounds)) {
      applyStableCameraBounds(this.sigma, this.coordinateBounds);
    }

    graph.nodes.forEach((node) => {
      this.graph?.addNode(node.id, {
        ...(node.attributes ?? {}),
        x: node.x,
        y: node.y,
        size: node.size,
        color: node.attributes?.is_cluster_proxy === true ? derivePositionedNodeColor(node) : node.color,
      });
    });
    graph.edges.forEach((edge) => {
      if (!this.graph?.hasNode(edge.source) || !this.graph.hasNode(edge.target)) {
        return;
      }
      this.graph.addEdgeWithKey(edge.id, edge.source, edge.target, edge.attributes ?? {});
    });
    this.updateClusterTriangleRotations();
    this.syncPieProgramsFromGraph();
    this.applyHighlighting();
    this.captureDisplayPositions();
    this.sigma.refresh();
    this.sigma.scheduleRender();
    if (cameraState) {
      this.suppressViewChangesFor(16);
      restoreCameraState(this.sigma, cameraState);
    }
    this.updateEdgeLabelVisibility(this.readSemanticViewState());
    if (wasTransitioning || lodChanged || planned.origins.size) this.animatePositions(targets);
    else {
      this.forceMotion.start(this.graph);
      this.manipulationHandler?.(false);
    }
  }

  private animatePositions(targets: ReadonlyMap<string, Point>): void {
    if (!this.graph) return;
    const starts = new Map(this.graph.mapNodes((id, a) => [id, { x: a.x, y: a.y }] as const));
    this.transitioning = true;
    this.forceMotion.suspend(true);
    this.manipulationHandler?.(true);
    const start = performance.now();
    const tick = (now: number) => {
      if (!this.graph) return;
      const t = Math.min(1, (now - start) / 240),
        eased = t * t * (3 - 2 * t);
      targets.forEach((target, id) => {
        const from = starts.get(id)!;
        this.graph!.mergeNodeAttributes(
          id,
          this.positions.set(id, {
            x: from.x + (target.x - from.x) * eased,
            y: from.y + (target.y - from.y) * eased,
          }),
        );
      });
      this.sigma?.refresh();
      this.preserveTransitionFocus();
      if (t < 1) this.transitionFrame = requestAnimationFrame(tick);
      else {
        this.transitionFrame = null;
        this.transitioning = false;
        this.transitionAnchor = null;
        this.forceMotion.start(this.graph);
        this.forceMotion.suspend(false);
        this.manipulationHandler?.(false);
        this.emitViewChange(this.readSemanticViewState());
      }
    };
    this.transitionFrame = requestAnimationFrame(tick);
  }

  private chooseTransitionAnchor(next: PositionedGraph): { ids: string[]; screen: Point } | null {
    if (!this.graph || !this.sigma) return null;
    const dimensions = this.sigma.getDimensions();
    const focus = this.zoomPointer ?? { x: dimensions.width / 2, y: dimensions.height / 2 };
    const nextIds = new Set(next.nodes.map((n) => n.id));
    const nextClusters = new Map<string, string[]>();
    for (const node of next.nodes) {
      const cluster = node.attributes?.cluster_id;
      if (typeof cluster === "string") {
        const ids = nextClusters.get(cluster) ?? [];
        ids.push(node.id);
        nextClusters.set(cluster, ids);
      }
    }
    let best: { ids: string[]; screen: Point } | null = null,
      distance = Infinity;
    this.graph.forEachNode((id, a) => {
      const ids = nextIds.has(id) ? [id] : (nextClusters.get(a.cluster_id) ?? []);
      if (!ids.length) return; // Never guess parentage between unrelated tiers.
      const screen = this.sigma!.graphToViewport({ x: a.x, y: a.y });
      const d = Math.hypot(screen.x - focus.x, screen.y - focus.y);
      if (d < distance) {
        best = { ids, screen };
        distance = d;
      }
    });
    return best;
  }

  private preserveTransitionFocus(): void {
    const anchor = this.transitionAnchor,
      sigma = this.sigma,
      graph = this.graph;
    if (!anchor || !sigma || !graph) return;
    const point = anchor.ids.reduce(
      (p, id) => {
        const a = graph.getNodeAttributes(id);
        return { x: p.x + a.x / anchor.ids.length, y: p.y + a.y / anchor.ids.length };
      },
      { x: 0, y: 0 },
    );
    const camera = sigma.getCamera(),
      cameraState = camera.getState();
    const options = { cameraState };
    const current = sigma.viewportToFramedGraph(sigma.graphToViewport(point, options), options);
    const desired = sigma.viewportToFramedGraph(anchor.screen, options);
    camera.setState({ x: cameraState.x + current.x - desired.x, y: cameraState.y + current.y - desired.y });
  }

  getInteractiveAggregateTargets(): readonly RenderInteractiveAggregateTarget[] {
    if (!this.graph || !this.sigma || !this.containerElement) return [];

    const rect = this.containerElement.getBoundingClientRect();
    const targets: RenderInteractiveAggregateTarget[] = [];
    this.graph.forEachNode((nodeId, attributes) => {
      if (!isInteractiveAggregate(attributes)) return;

      const point = this.sigma?.graphToViewport({ x: Number(attributes.x), y: Number(attributes.y) });
      if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;

      targets.push({
        clusterId: typeof attributes.cluster_id === "string" ? attributes.cluster_id : nodeId,
        representedNodeCount: attributes.member_count as number,
        clientX: rect.left + point.x,
        clientY: rect.top + point.y,
      });
    });
    return targets.sort((left, right) => left.clusterId.localeCompare(right.clusterId));
  }

  fitGraphSnapshot(graph: PositionedGraph, options: { resetFirst?: boolean } = {}): (() => void) | null {
    if (!this.sigma) {
      return null;
    }
    this.cancelCameraFit();
    this.cancelFit = fitSigmaToGraphSnapshot(this.sigma, graph, options);
    return this.cancelFit;
  }

  // Dim every node/edge outside `nodeIds` so the selected region stands out.
  // An empty set or null clears the highlight and repaints at full opacity.
  setHighlightedNodes(nodeIds: ReadonlySet<string> | null): void {
    this.highlightedNodeIds = nodeIds && nodeIds.size > 0 ? nodeIds : null;
    this.applyHighlighting();
    this.sigma?.scheduleRender?.();
  }

  // Install node/edge reducers that grey out anything outside the active
  // highlight set. Reinstalled after every Sigma rebuild via bindSigmaHandlers
  // so the highlight survives piechart-program registration.
  private applyHighlighting(): void {
    this.syncSelectedClusterStyle();
    applySigmaHighlighting({
      graph: this.graph,
      sigma: this.sigma,
      highlightedNodeIds: this.highlightedNodeIds,
      selectedNodeId: this.selectedNodeId,
    });
  }

  // Register piechart programs for the live LoD graph and flip pie nodes to the
  // piechart type once the program exists. Invoked while applying each viewport
  // graph snapshot, before Sigma refreshes.
  // Mirrors the legacy ensureSigmaPiePrograms flow but reads slice keys from
  // the graphology graph (sync writes attributes directly rather than via
  // addPositionedNode).
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
    if (!areStringArraysEqual(this.pieSliceKeys, detectedSliceKeys) || this.pieProgramSignature !== nextSignature) {
      try {
        this.rebuildSigma(detectedSliceKeys, nodeViews, nextSignature);
      } catch (error) {
        console.warn("Failed to build Sigma piechart program; falling back to default nodes.", {
          sliceCount: detectedSliceKeys.length,
          sliceKeys: detectedSliceKeys,
          error,
        });
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
        Object.keys(attributes).some((key) => key.startsWith(PIE_ATTRIBUTE_PREFIX)),
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
    const nextSignature = buildPieProgramSignature(detectedSliceKeys, graph.nodes);
    if (!areStringArraysEqual(this.pieSliceKeys, detectedSliceKeys) || this.pieProgramSignature !== nextSignature) {
      try {
        this.rebuildSigma(detectedSliceKeys, graph.nodes, nextSignature);
      } catch (error) {
        console.warn("Failed to build Sigma piechart program; falling back to default nodes.", {
          sliceCount: detectedSliceKeys.length,
          sliceKeys: detectedSliceKeys,
          error,
        });
        this.rebuildSigma([], [], "");
      }
    }
  }

  private rebuildSigma(
    sliceKeys: string[],
    nodes: readonly PieNodeView[] = [],
    signature = buildPieProgramSignature(sliceKeys, nodes),
  ): void {
    this.cancelCameraFit();
    const previousCameraState = readCameraState(this.sigma);
    const previousSigma = this.sigma;
    const sigmaSettings = buildSigmaSettings(
      this.rendererOptions,
      piechartProgramClasses(sliceKeys, nodes, this.piechartOptions),
    );

    this.unbindSigmaHandlers();
    previousSigma?.kill();
    this.sigma = new Sigma(this.graph as Graph, this.containerElement as HTMLElement, sigmaSettings);
    this.pieSliceKeys = sliceKeys;
    this.pieProgramSignature = signature;
    // Camera coordinates are relative to this frame, not the currently loaded slice.
    applyStableCameraBounds(this.sigma, this.coordinateBounds);
    this.sigma.refresh();
    restoreCameraState(this.sigma, previousCameraState);
    this.bindSigmaHandlers();
  }

  private bindSigmaHandlers(): void {
    this.containerElement?.addEventListener("wheel", this.trackZoomPointer, { capture: true, passive: true });
    for (const event of ["pointerdown", "wheel", "touchstart"]) {
      this.containerElement?.addEventListener(event, this.cancelCameraFit, { capture: true, passive: true });
    }
    this.bindCameraHandler();
    this.bindNodeClickHandler();
    this.bindStageClickHandler();
    this.dragController.bind();
    this.boxSelectController.bind();
    this.applyHighlighting();
  }

  private unbindSigmaHandlers(): void {
    this.containerElement?.removeEventListener("wheel", this.trackZoomPointer, true);
    this.cancelCameraFit();
    for (const event of ["pointerdown", "wheel", "touchstart"]) {
      this.containerElement?.removeEventListener(event, this.cancelCameraFit, true);
    }
    this.boxSelectController.unbind();
    this.dragController.unbind();
    this.unbindStageClickHandler();
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
      on?: (event: string, handler: (payload: { node?: string; event?: { node?: string } }) => void) => void;
      off?: (event: string, handler: (payload: { node?: string; event?: { node?: string } }) => void) => void;
    } | null;
    sigma?.off?.("clickNode", this.boundNodeClicked);
    sigma?.on?.("clickNode", this.boundNodeClicked);
    sigma?.off?.("doubleClickNode", this.boundNodeDoubleClicked);
    sigma?.on?.("doubleClickNode", this.boundNodeDoubleClicked);
  }

  private bindStageClickHandler(): void {
    const sigma = this.sigma as {
      on?: (event: string, handler: () => void) => void;
      off?: (event: string, handler: () => void) => void;
    } | null;
    sigma?.off?.("clickStage", this.boundStageClicked);
    sigma?.on?.("clickStage", this.boundStageClicked);
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
      off?: (event: string, handler: (payload: { node?: string; event?: { node?: string } }) => void) => void;
    } | null;
    sigma?.off?.("clickNode", this.boundNodeClicked);
    sigma?.off?.("doubleClickNode", this.boundNodeDoubleClicked);
  }

  private unbindStageClickHandler(): void {
    const sigma = this.sigma as {
      off?: (event: string, handler: () => void) => void;
    } | null;
    sigma?.off?.("clickStage", this.boundStageClicked);
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
    return sigmaCameraToSemanticViewState(this.coordinateBounds, camera.getState?.() ?? camera);
  }

  private currentViewportBounds(): RenderViewportBounds {
    const sigma = this.sigma;
    if (!sigma) {
      return { xmin: 0, xmax: 0, ymin: 0, ymax: 0 };
    }
    const dimensions = sigma.getDimensions?.() ?? sigma.getContainer?.().getBoundingClientRect();
    const width = dimensions?.width ?? 1;
    const height = dimensions?.height ?? 1;
    const corners = [
      sigma.viewportToGraph({ x: 0, y: 0 }),
      sigma.viewportToGraph({ x: width, y: 0 }),
      sigma.viewportToGraph({ x: 0, y: height }),
      sigma.viewportToGraph({ x: width, y: height }),
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

  private currentCameraRatio(): number {
    const camera = this.sigma?.getCamera();
    const state = camera?.getState?.() ?? camera;
    return typeof state?.ratio === "number" && Number.isFinite(state.ratio) ? state.ratio : 1;
  }

  private emitViewChange(viewState: SigmaSemanticViewState | null): void {
    if (this.transitioning) return;
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

  private updateEdgeLabelVisibility(viewState: SigmaSemanticViewState | null): void {
    if (!this.sigma || !viewState) {
      return;
    }

    const shouldRender =
      this.rendererOptions.display?.edgeDistanceLabels === true &&
      (this.rendererOptions.display.edgeDistanceLabelPolicy === "always" || viewState.edgeDistanceLabelsVisible);

    if (this.sigma.getSetting("renderEdgeLabels") !== shouldRender) {
      this.sigma.setSetting("renderEdgeLabels", shouldRender);
      this.sigma.scheduleRender();
    }
  }

  private emitNodeClick(payload: { node?: string; event?: { node?: string } }): void {
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
    this.applyHighlighting();
    this.sigma?.scheduleRender?.();
    this.nodeClickHandler({
      nodeId,
      attributes: this.graph.getNodeAttributes(nodeId) as Record<string, unknown>,
    });
  }

  private emitNodeDoubleClick(payload: { node?: string; event?: { node?: string } }): void {
    if (Date.now() < this.suppressNodeClicksUntil || !this.nodeDoubleClickHandler || !this.graph) {
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

    this.nodeDoubleClickHandler({
      nodeId,
      attributes: this.graph.getNodeAttributes(nodeId) as Record<string, unknown>,
    });
  }

  private clearNodeSelection(): void {
    if (Date.now() < this.suppressNodeClicksUntil) {
      return;
    }

    this.selectedNodeId = null;
    this.applyHighlighting();
    this.sigma?.scheduleRender?.();
    this.nodeClickHandler?.({ nodeId: null });
  }

  private syncSelectedClusterStyle(): void {
    if (!this.graph) return;

    if (this.selectedClusterStyle && this.selectedClusterStyle.id !== this.selectedNodeId) {
      if (this.graph.hasNode(this.selectedClusterStyle.id)) {
        this.graph.mergeNodeAttributes(this.selectedClusterStyle.id, {
          color: this.selectedClusterStyle.color,
          size: this.selectedClusterStyle.size,
        });
      }
      this.selectedClusterStyle = null;
    }

    if (!this.selectedNodeId || this.selectedClusterStyle || !this.graph.hasNode(this.selectedNodeId)) return;

    const attributes = this.graph.getNodeAttributes(this.selectedNodeId) as Record<string, unknown>;
    if (attributes.type !== SIGMA_NODE_TYPE_TRIANGLE && attributes.is_cluster_proxy !== true) return;

    const size = typeof attributes.size === "number" ? attributes.size : 5;
    this.selectedClusterStyle = {
      id: this.selectedNodeId,
      color: attributes.color,
      size: attributes.size,
    };
    this.graph.mergeNodeAttributes(this.selectedNodeId, {
      color: PHYLOVIZ_NODE_SELECTED_COLOR,
      size: Math.max(size * 1.35, size + 2),
    });
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
function isInteractiveAggregate(attributes: Record<string, unknown>): boolean {
  return (
    attributes.type === "triangle" ||
    attributes.is_cluster_proxy === true ||
    (typeof attributes.member_count === "number" && attributes.member_count > 1)
  );
}

function graphNodeViews(graph: Graph): PieNodeView[] {
  return graph.mapNodes((_nodeId, attributes) => ({
    attributes: attributes as Record<string, unknown>,
  }));
}

function graphBoundsEqual(left: GraphBounds | null, right: GraphBounds | null): boolean {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return left.minX === right.minX && left.maxX === right.maxX && left.minY === right.minY && left.maxY === right.maxY;
}

function applyClusterTriangleRotations(graph: Graph, edges: PositionedGraph["edges"]): void {
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
        Math.atan2(Number(target.y) - Number(source.y), Number(target.x) - Number(source.x)),
      );
    }
    if (target.is_cluster_proxy === true) {
      graph.setNodeAttribute(
        edge.target,
        "triangleRotation",
        Math.atan2(Number(source.y) - Number(target.y), Number(source.x) - Number(target.x)),
      );
    }
  });
}
