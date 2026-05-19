import Graph from "graphology";
import Sigma from "sigma";
import { createNodePiechartProgram } from "@sigma/node-piechart";

import type {
  PositionedGraph,
  PositionedGraphBounds,
} from "../../contracts/positioned";
import { TriangleNodeProgram } from "../nodePrograms/triangleNodeProgram";
import {
  RENDERER_KIND_SIGMA,
} from "../types";
import type {
  GraphRenderer,
  RenderContext,
  RenderNodeClickState,
  RendererKind,
  RenderViewportState,
} from "../types";
import {
  buildPiePalette,
  detectPieSliceKeys,
  PIE_PALETTE_ATTRIBUTE,
} from "../pieMapping";

export const SIGMA_DEFAULT_CAMERA_ZOOM = 1;
export const SIGMA_MIN_CAMERA_RATIO = 0.002;
export const SIGMA_MAX_CAMERA_RATIO = 10;
export const SIGMA_MAX_LOD_ZOOM = 8;
export const SIGMA_ZOOMING_RATIO = 1.4;
export const SIGMA_DEFAULT_NODE_SIZE = 6;
export const SIGMA_DEFAULT_NODE_COLOR = "#0f766e";
export const SIGMA_DEFAULT_EDGE_COLOR = "#94a3b8";
export const SIGMA_DEFAULT_EDGE_SIZE = 1.25;
export const SIGMA_DEFAULT_CAMERA_X = 0.5;
export const SIGMA_DEFAULT_CAMERA_Y = 0.5;

export const SIGMA_DEFAULT_LABEL_COLOR = "#0f172a";
export const SIGMA_DEFAULT_LABEL_SIZE = 13;
export const SIGMA_DEFAULT_LABEL_DENSITY = 0.9;
export const SIGMA_DEFAULT_LABEL_GRID_CELL_SIZE = 90;
export const SIGMA_DEFAULT_LABEL_RENDERED_SIZE_THRESHOLD = 4;

export const SIGMA_NODE_TYPE_DEFAULT = "circle";
export const SIGMA_NODE_TYPE_TRIANGLE = "triangle";
export const SIGMA_NODE_TYPE_PIECHART = "piechart";

export const ERR_CONTAINER_NOT_FOUND =
  "Sigma container not found: {containerId}";
export const ERR_SIGMA_NOT_READY = "Sigma renderer is not mounted.";

export interface SigmaPiechartOptions {
  enabled?: boolean;
  palette?: string[];
}

export interface SigmaRendererOptions {
  piechart?: SigmaPiechartOptions;
  label?: {
    enabled?: boolean;
    color?: string;
    size?: number;
    density?: number;
    gridCellSize?: number;
    renderedSizeThreshold?: number;
  };
  edge?: {
    size?: number;
    color?: string;
  };
}

interface GraphBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

type SigmaNodeProgramClasses = Record<string, unknown>;

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
  private viewChangeHandler: ((state: RenderViewportState) => void) | null =
    null;
  private nodeClickHandler: ((state: RenderNodeClickState) => void) | null =
    null;
  private suppressNextViewChange = false;
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
      this.buildSigmaSettings(),
    );
    this.sigma.getCamera().setState(defaultCameraState());
    this.bindCameraHandler();
    this.bindNodeClickHandler();
  }

  // Render positioned nodes and edges into Graphology then refresh Sigma.
  render(graph: PositionedGraph): void {
    if (!this.graph || !this.sigma) {
      throw new Error(ERR_SIGMA_NOT_READY);
    }

    // Clear previous frame first so Sigma rebuilds never see stale piechart nodes.
    this.graph.clear();
    this.graphBounds = deriveGraphBounds(graph);
    this.coordinateBounds =
      normalizeGraphBounds(graph.viewMeta.globalBounds) ?? this.graphBounds;
    this.ensureSigmaPiePrograms(graph);

    graph.nodes.forEach((node) => {
      const hasPieData = this.pieSliceKeys.some(
        (key) => toPositiveNumber(node.attributes?.[key]) > 0,
      );
      const isClusterProxy = node.attributes?.is_cluster_proxy === true;
      const nodeType =
        hasPieData && this.pieSliceKeys.length > 0
          ? SIGMA_NODE_TYPE_PIECHART
          : isClusterProxy
            ? SIGMA_NODE_TYPE_TRIANGLE
            : SIGMA_NODE_TYPE_DEFAULT;

      const pieAttributes: Record<string, number> = {};
      this.pieSliceKeys.forEach((key) => {
        pieAttributes[key] = toPositiveNumber(node.attributes?.[key]);
      });

      this.graph?.addNode(node.id, {
        x: node.x,
        y: node.y,
        size: node.size ?? SIGMA_DEFAULT_NODE_SIZE,
        color: node.color ?? SIGMA_DEFAULT_NODE_COLOR,
        label:
          this.rendererOptions.label?.enabled === false
            ? ""
            : deriveNodeLabel(node.id, node.attributes),
        ...(node.attributes ?? {}),
        ...pieAttributes,
        type: nodeType,
      });
    });

    graph.edges.forEach((edge) => {
      const sourceExists = this.graph?.hasNode(edge.source) ?? false;
      const targetExists = this.graph?.hasNode(edge.target) ?? false;

      if (!sourceExists || !targetExists) {
        return;
      }

      this.graph?.addEdgeWithKey(edge.id, edge.source, edge.target, {
        color: this.rendererOptions.edge?.color ?? SIGMA_DEFAULT_EDGE_COLOR,
        size: this.rendererOptions.edge?.size ?? SIGMA_DEFAULT_EDGE_SIZE,
        ...(edge.attributes ?? {}),
      });
    });

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

    this.suppressNextViewChange = true;
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
    this.unbindNodeClickHandler();
    this.unbindCameraHandler();
    this.sigma?.kill();
    this.sigma = null;
    this.graph = null;
    this.containerElement = null;
    this.pieSliceKeys = [];
    this.graphBounds = null;
    this.coordinateBounds = null;
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
    this.sigma?.kill();
    this.sigma = null;

    this.pieSliceKeys = sliceKeys;

    if (sliceKeys.length === 0) {
      this.sigma = new Sigma(
        this.graph as Graph,
        this.containerElement as HTMLElement,
        this.buildSigmaSettings(),
      );
      this.restoreCameraState(previousCameraState);
      this.bindCameraHandler();
      this.bindNodeClickHandler();
      return;
    }

    const runtimePalette = resolvePaletteFromGraph(graph);
    const palette = buildPiePalette(
      sliceKeys.length,
      runtimePalette ?? this.piechartOptions.palette,
    );
    const slices = sliceKeys.map((attributeKey, index) => ({
      color: { value: palette[index] as string },
      value: { attribute: attributeKey },
    })) as [
      { color: { value: string }; value: { attribute: string } },
      ...Array<{ color: { value: string }; value: { attribute: string } }>,
    ];

    const NodePiechartProgram = createNodePiechartProgram({
      defaultColor: SIGMA_DEFAULT_NODE_COLOR,
      slices,
    });

    this.sigma = new Sigma(
      this.graph as Graph,
      this.containerElement as HTMLElement,
      this.buildSigmaSettings({
        [SIGMA_NODE_TYPE_PIECHART]: NodePiechartProgram,
      }),
    );
    this.restoreCameraState(previousCameraState);
    this.bindCameraHandler();
    this.bindNodeClickHandler();
  }

  private buildSigmaSettings(
    nodeProgramClasses: SigmaNodeProgramClasses = {},
  ): Record<string, unknown> {
    return {
      renderLabels: this.rendererOptions.label?.enabled !== false,
      minCameraRatio: SIGMA_MIN_CAMERA_RATIO,
      maxCameraRatio: SIGMA_MAX_CAMERA_RATIO,
      zoomingRatio: SIGMA_ZOOMING_RATIO,
      labelRenderedSizeThreshold:
        this.rendererOptions.label?.renderedSizeThreshold ??
        SIGMA_DEFAULT_LABEL_RENDERED_SIZE_THRESHOLD,
      labelDensity:
        this.rendererOptions.label?.density ?? SIGMA_DEFAULT_LABEL_DENSITY,
      labelGridCellSize:
        this.rendererOptions.label?.gridCellSize ??
        SIGMA_DEFAULT_LABEL_GRID_CELL_SIZE,
      labelColor: {
        color: this.rendererOptions.label?.color ?? SIGMA_DEFAULT_LABEL_COLOR,
      },
      labelSize: this.rendererOptions.label?.size ?? SIGMA_DEFAULT_LABEL_SIZE,
      nodeProgramClasses: {
        [SIGMA_NODE_TYPE_TRIANGLE]: TriangleNodeProgram,
        ...nodeProgramClasses,
      },
    };
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
    if (this.suppressNextViewChange) {
      this.suppressNextViewChange = false;
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
    camera.setState(
      state ?? defaultCameraState(),
    );
  }
}

function defaultCameraState(): { x: number; y: number; ratio: number } {
  return {
    x: SIGMA_DEFAULT_CAMERA_X,
    y: SIGMA_DEFAULT_CAMERA_Y,
    ratio: SIGMA_DEFAULT_CAMERA_ZOOM,
  };
}

export function sigmaRatioToLodZoom(ratio: number): number {
  if (!Number.isFinite(ratio) || ratio <= 0) {
    return 0.5;
  }

  const zoom = 1 + Math.log2(1 / ratio);
  return Math.min(SIGMA_MAX_LOD_ZOOM, Math.max(0.5, zoom));
}

export function sigmaCameraToViewportState(
  bounds: GraphBounds,
  camera: { x?: number; y?: number; ratio?: number },
): RenderViewportState["viewport"] {
  const spanX = Math.max(bounds.maxX - bounds.minX, 1);
  const spanY = Math.max(bounds.maxY - bounds.minY, 1);
  const normalizedX = clampUnit(camera.x ?? SIGMA_DEFAULT_CAMERA_X);
  const normalizedY = clampUnit(camera.y ?? SIGMA_DEFAULT_CAMERA_Y);
  const ratio =
    typeof camera.ratio === "number" && Number.isFinite(camera.ratio)
      ? Math.max(camera.ratio, SIGMA_MIN_CAMERA_RATIO)
      : SIGMA_DEFAULT_CAMERA_ZOOM;

  return {
    x: bounds.minX + normalizedX * spanX,
    y: bounds.minY + normalizedY * spanY,
    width: spanX * ratio,
    height: spanY * ratio,
  };
}

export function graphCoordinatesToCameraCenter(
  bounds: GraphBounds,
  point: { x: number; y: number },
): { x: number; y: number } {
  const spanX = Math.max(bounds.maxX - bounds.minX, 1);
  const spanY = Math.max(bounds.maxY - bounds.minY, 1);

  return {
    x: clampUnit((point.x - bounds.minX) / spanX),
    y: clampUnit((point.y - bounds.minY) / spanY),
  };
}

function toPositiveNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return 0;
  }
  return value;
}

function areStringArraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }

  return true;
}

function resolvePaletteFromGraph(
  graph: PositionedGraph | undefined,
): string[] | undefined {
  if (!graph) {
    return undefined;
  }

  for (const node of graph.nodes) {
    const paletteValue = node.attributes?.[PIE_PALETTE_ATTRIBUTE];
    if (!Array.isArray(paletteValue)) {
      continue;
    }

    const colors = paletteValue.filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    );
    if (colors.length > 0) {
      return colors;
    }
  }

  return undefined;
}

function deriveGraphBounds(graph: PositionedGraph): GraphBounds | null {
  if (graph.nodes.length === 0) {
    return null;
  }

  let minX = graph.nodes[0]?.x ?? 0;
  let maxX = minX;
  let minY = graph.nodes[0]?.y ?? 0;
  let maxY = minY;

  graph.nodes.forEach((node) => {
    minX = Math.min(minX, node.x);
    maxX = Math.max(maxX, node.x);
    minY = Math.min(minY, node.y);
    maxY = Math.max(maxY, node.y);
  });

  return { minX, maxX, minY, maxY };
}

function normalizeGraphBounds(
  bounds: PositionedGraphBounds | undefined,
): GraphBounds | null {
  if (!bounds) {
    return null;
  }

  if (
    !Number.isFinite(bounds.minX) ||
    !Number.isFinite(bounds.maxX) ||
    !Number.isFinite(bounds.minY) ||
    !Number.isFinite(bounds.maxY)
  ) {
    return null;
  }

  return bounds;
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) {
    return 0.5;
  }
  return Math.min(1, Math.max(0, value));
}

function deriveNodeLabel(
  nodeId: string,
  attributes: Record<string, unknown> | undefined,
): string {
  const explicitLabel = attributes?.label;
  if (typeof explicitLabel === "string" && explicitLabel.trim().length > 0) {
    return explicitLabel.trim();
  }

  const metadataCandidate = attributes?.metadata;
  if (metadataCandidate && typeof metadataCandidate === "object") {
    const metadata = metadataCandidate as Record<string, unknown>;
    const name = metadata.name;
    if (typeof name === "string" && name.trim().length > 0) {
      return name.trim();
    }
  }

  return nodeId;
}
