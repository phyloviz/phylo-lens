import Graph from "graphology";
import Sigma from "sigma";

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
import { detectPieSliceKeys } from "../../pieMapping";
import {
  defaultCameraState,
  deriveGraphBounds,
  type GraphBounds,
  normalizeGraphBounds,
  SIGMA_DEFAULT_CAMERA_X,
  SIGMA_DEFAULT_CAMERA_Y,
  SIGMA_DEFAULT_CAMERA_ZOOM,
  sigmaCameraToViewportState,
  sigmaRatioToLodZoom,
} from "./sigmaCamera";
import { SigmaDragController } from "./sigmaDragController";
import createSigmaForceMotion from "./sigmaForceMotion";
import {
  addPositionedEdges,
  addPositionedNode,
  areStringArraysEqual,
  buildPieProgramSignature,
  buildSigmaSettings,
  piechartProgramClasses,
  type SigmaPiechartOptions,
  type SigmaRendererOptions,
} from "./sigmaNodeRendering";
import {
  applyStableCameraBounds,
  centerCameraOnGraphNode,
  readCameraState,
  restoreCameraState,
} from "./sigmaRendererCameraState";

export {
  SIGMA_DEFAULT_CAMERA_ZOOM,
  SIGMA_MAX_LOD_ZOOM,
  sigmaCameraToViewportState,
  sigmaRatioToLodZoom,
} from "./sigmaCamera";
export type { SigmaPiechartOptions, SigmaRendererOptions };

export const ERR_CONTAINER_NOT_FOUND =
  "Sigma container not found: {containerId}";
export const ERR_SIGMA_NOT_READY = "Sigma renderer is not mounted.";
export const SIGMA_EDGE_LABEL_MAX_CAMERA_RATIO = 0.5;

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
  private readonly dragController: SigmaDragController;
  private readonly forceMotion: ReturnType<typeof createSigmaForceMotion>;
  private viewChangeHandler: ((state: RenderViewportState) => void) | null =
    null;
  private nodeClickHandler: ((state: RenderNodeClickState) => void) | null =
    null;
  private suppressViewChangesUntil = 0;
  private suppressNodeClicksUntil = 0;
  private lastRenderedGraph: PositionedGraph | null = null;
  private selectedNodeId: string | null = null;
  private readonly boundCameraUpdated = () => {
    this.updateEdgeLabelVisibility();
    this.emitViewChange();
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
    this.dragController = new SigmaDragController({
      getGraph: () => this.graph,
      getSigma: () => this.sigma,
      suppressViewChangesFor: (durationMs) =>
        this.suppressViewChangesFor(durationMs),
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
    this.updateEdgeLabelVisibility();
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

  centerOnNode(nodeId: string): void {
    if (
      !centerCameraOnGraphNode({
        graph: this.graph,
        sigma: this.sigma,
        coordinateBounds: this.coordinateBounds,
        nodeId,
        beforeSetState: () => this.suppressViewChangesFor(450),
      })
    ) {
      return;
    }

    this.selectedNodeId = nodeId;
    this.renderSelectedNodeState();
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
      this.rebuildSigma(this.pieSliceKeys, this.lastRenderedGraph ?? undefined);
    }
  }

  // Drop container and graph references when renderer is detached.
  unmount(): void {
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
    this.dragController.reset();
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
    const nextSignature = buildPieProgramSignature(detectedSliceKeys, graph);
    if (
      !areStringArraysEqual(this.pieSliceKeys, detectedSliceKeys) ||
      this.pieProgramSignature !== nextSignature
    ) {
      try {
        this.rebuildSigma(detectedSliceKeys, graph, nextSignature);
      } catch (error) {
        console.warn(
          "Failed to build Sigma piechart program; falling back to default nodes.",
          {
            sliceCount: detectedSliceKeys.length,
            sliceKeys: detectedSliceKeys,
            error,
          },
        );
        this.rebuildSigma([], undefined, "");
      }
    }
  }

  private rebuildSigma(
    sliceKeys: string[],
    graph?: PositionedGraph,
    signature = buildPieProgramSignature(sliceKeys, graph),
  ): void {
    const previousCameraState = readCameraState(this.sigma);
    const previousSigma = this.sigma;
    const sigmaSettings = buildSigmaSettings(
      this.rendererOptions,
      piechartProgramClasses(sliceKeys, graph, this.piechartOptions),
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
  }

  private bindSigmaHandlers(): void {
    this.bindCameraHandler();
    this.bindNodeClickHandler();
    this.dragController.bind();
  }

  private unbindSigmaHandlers(): void {
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

  private emitViewChange(): void {
    if (Date.now() < this.suppressViewChangesUntil) {
      return;
    }

    if (
      !this.viewChangeHandler ||
      !this.sigma ||
      !this.containerElement ||
      !this.coordinateBounds
    ) {
      return;
    }

    const camera = this.sigma.getCamera() as {
      x?: number;
      y?: number;
      ratio?: number;
      getState?: () => { x?: number; y?: number; ratio?: number };
    };
    const state = camera.getState?.() ?? camera;
    const ratio =
      typeof state.ratio === "number" && Number.isFinite(state.ratio)
        ? state.ratio
        : SIGMA_DEFAULT_CAMERA_ZOOM;
    const viewport = sigmaCameraToViewportState(this.coordinateBounds, {
      x: typeof state.x === "number" ? state.x : SIGMA_DEFAULT_CAMERA_X,
      y: typeof state.y === "number" ? state.y : SIGMA_DEFAULT_CAMERA_Y,
      ratio,
    });

    this.viewChangeHandler({
      viewport,
      zoom: sigmaRatioToLodZoom(ratio),
    });
  }

  private updateEdgeLabelVisibility(): void {
    if (!this.sigma) {
      return;
    }

    const camera = this.sigma.getCamera() as {
      ratio?: number;
      getState?: () => { ratio?: number };
    };
    const state = camera.getState?.() ?? camera;
    const ratio =
      typeof state.ratio === "number" && Number.isFinite(state.ratio)
        ? state.ratio
        : SIGMA_DEFAULT_CAMERA_ZOOM;
    const shouldRender =
      this.rendererOptions.display?.edgeDistanceLabels === true &&
      ratio <= SIGMA_EDGE_LABEL_MAX_CAMERA_RATIO;

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
