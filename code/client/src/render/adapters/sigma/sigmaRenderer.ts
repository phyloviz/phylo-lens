import Graph from "graphology";
import Sigma from "sigma";

import type { PositionedGraph } from "../../../contracts/positioned";
import { RENDERER_KIND_SIGMA } from "../../types";
import type {
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
  graphCoordinatesToCameraCenter,
  type GraphBounds,
  normalizeGraphBounds,
  SIGMA_DEFAULT_CAMERA_X,
  SIGMA_DEFAULT_CAMERA_Y,
  SIGMA_DEFAULT_CAMERA_ZOOM,
  sigmaCameraToViewportState,
  sigmaRatioToLodZoom,
} from "./sigmaCamera";
import { SigmaDragController } from "./sigmaDragController";
import {
  addPositionedEdges,
  addPositionedNode,
  areStringArraysEqual,
  buildSigmaSettings,
  piechartProgramClasses,
  type SigmaPiechartOptions,
  type SigmaRendererOptions,
} from "./sigmaNodeRendering";

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

// Sigma renderer adapter keeps Sigma-specific behavior isolated from core contracts.
export class SigmaRenderer implements GraphRenderer {
  readonly kind: RendererKind = RENDERER_KIND_SIGMA;

  private graph: Graph | null = null;
  private sigma: Sigma | null = null;
  private containerElement: HTMLElement | null = null;
  private pieSliceKeys: string[] = [];
  private graphBounds: GraphBounds | null = null;
  private coordinateBounds: GraphBounds | null = null;
  private piechartOptions: SigmaPiechartOptions;
  private readonly rendererOptions: SigmaRendererOptions;
  private readonly dragController: SigmaDragController;
  private viewChangeHandler: ((state: RenderViewportState) => void) | null =
    null;
  private nodeClickHandler: ((state: RenderNodeClickState) => void) | null =
    null;
  private suppressViewChangesUntil = 0;
  private suppressNodeClicksUntil = 0;
  private readonly boundCameraUpdated = () => {
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
    this.graph.clear();
    this.graphBounds = deriveGraphBounds(graph.nodes);
    this.coordinateBounds =
      normalizeGraphBounds(graph.viewMeta.globalBounds) ?? this.graphBounds;
    this.ensureSigmaPiePrograms(graph);
    this.applyStableCameraBounds();

    graph.nodes.forEach((node) => {
      addPositionedNode(
        this.graph as Graph,
        node,
        this.pieSliceKeys,
        this.rendererOptions,
      );
    });
    addPositionedEdges(this.graph, graph, this.rendererOptions);

    this.sigma.refresh();
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
    if (!this.sigma || !this.coordinateBounds || !this.graph?.hasNode(nodeId)) {
      return;
    }

    const attributes = this.graph.getNodeAttributes(nodeId) as Record<
      string,
      unknown
    >;
    const nodeX =
      typeof attributes.x === "number" && Number.isFinite(attributes.x)
        ? attributes.x
        : null;
    const nodeY =
      typeof attributes.y === "number" && Number.isFinite(attributes.y)
        ? attributes.y
        : null;
    if (nodeX === null || nodeY === null) {
      return;
    }

    const camera = this.sigma.getCamera() as {
      x?: number;
      y?: number;
      ratio?: number;
      getState?: () => { x?: number; y?: number; ratio?: number };
      setState: (state: { x?: number; y?: number; ratio?: number }) => void;
    };
    const currentState = camera.getState?.() ?? camera;
    const nextCenter = graphCoordinatesToCameraCenter(this.coordinateBounds, {
      x: nodeX,
      y: nodeY,
    });

    this.suppressViewChangesFor(450);
    camera.setState({
      x: nextCenter.x,
      y: nextCenter.y,
      ratio:
        typeof currentState.ratio === "number" &&
        Number.isFinite(currentState.ratio)
          ? currentState.ratio
          : SIGMA_DEFAULT_CAMERA_ZOOM,
    });
  }

  // Drop container and graph references when renderer is detached.
  unmount(): void {
    this.unbindSigmaHandlers();
    this.sigma?.kill();
    this.sigma = null;
    this.graph = null;
    this.containerElement = null;
    this.pieSliceKeys = [];
    this.graphBounds = null;
    this.coordinateBounds = null;
    this.dragController.reset();
  }

  private suppressViewChangesFor(durationMs: number): void {
    this.suppressViewChangesUntil = Date.now() + durationMs;
  }

  private suppressNodeClicksFor(durationMs: number): void {
    this.suppressNodeClicksUntil = Date.now() + durationMs;
  }

  private applyStableCameraBounds(): void {
    if (!this.sigma) {
      return;
    }

    this.sigma.setCustomBBox(
      this.coordinateBounds
        ? {
            x: [this.coordinateBounds.minX, this.coordinateBounds.maxX],
            y: [this.coordinateBounds.minY, this.coordinateBounds.maxY],
          }
        : null,
    );
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
    if (!areStringArraysEqual(this.pieSliceKeys, detectedSliceKeys)) {
      this.rebuildSigma(detectedSliceKeys, graph);
    }
  }

  private rebuildSigma(sliceKeys: string[], graph?: PositionedGraph): void {
    const previousCameraState = this.readCameraState();
    this.unbindSigmaHandlers();
    this.sigma?.kill();
    this.sigma = null;
    this.pieSliceKeys = sliceKeys;

    this.sigma = new Sigma(
      this.graph as Graph,
      this.containerElement as HTMLElement,
      buildSigmaSettings(
        this.rendererOptions,
        piechartProgramClasses(sliceKeys, graph, this.piechartOptions),
      ),
    );
    this.restoreCameraState(previousCameraState);
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

    this.nodeClickHandler({
      nodeId,
      attributes: this.graph.getNodeAttributes(nodeId) as Record<
        string,
        unknown
      >,
    });
  }

  private readCameraState(): { x?: number; y?: number; ratio?: number } | null {
    if (!this.sigma) {
      return null;
    }

    const camera = this.sigma.getCamera() as {
      getState?: () => { x?: number; y?: number; ratio?: number };
    };
    return camera.getState?.() ?? null;
  }

  private restoreCameraState(
    state: { x?: number; y?: number; ratio?: number } | null,
  ): void {
    if (!this.sigma) {
      return;
    }

    const camera = this.sigma.getCamera() as {
      setState: (state: { x?: number; y?: number; ratio?: number }) => void;
    };
    camera.setState(state ?? defaultCameraState());
  }
}
