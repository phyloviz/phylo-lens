import Graph from "graphology";
import Sigma from "sigma";
import { createNodePiechartProgram } from "@sigma/node-piechart";

import { PositionedGraph } from "../../contracts/positioned";
import {
  GraphRenderer,
  RENDERER_KIND_SIGMA,
  RenderContext,
  RendererKind,
} from "../types";
import {
  buildPiePalette,
  detectPieSliceKeys,
  PIE_PALETTE_ATTRIBUTE,
} from "../pieMapping";

export const SIGMA_DEFAULT_CAMERA_ZOOM = 1;
export const SIGMA_DEFAULT_NODE_SIZE = 6;
export const SIGMA_DEFAULT_NODE_COLOR = "#0f766e";
export const SIGMA_DEFAULT_EDGE_COLOR = "#94a3b8";
export const SIGMA_DEFAULT_EDGE_SIZE = 1.25;

export const SIGMA_DEFAULT_LABEL_COLOR = "#0f172a";
export const SIGMA_DEFAULT_LABEL_SIZE = 13;
export const SIGMA_DEFAULT_LABEL_DENSITY = 0.9;
export const SIGMA_DEFAULT_LABEL_GRID_CELL_SIZE = 90;
export const SIGMA_DEFAULT_LABEL_RENDERED_SIZE_THRESHOLD = 4;

export const SIGMA_NODE_TYPE_DEFAULT = "circle";
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

// Sigma renderer adapter keeps Sigma-specific behavior isolated from core contracts.
export class SigmaRenderer implements GraphRenderer {
  readonly kind: RendererKind = RENDERER_KIND_SIGMA;

  private containerId: string | null = null;
  private graph: Graph | null = null;
  private sigma: Sigma | null = null;
  private containerElement: HTMLElement | null = null;
  private pieSliceKeys: string[] = [];
  private piechartOptions: SigmaPiechartOptions;
  private readonly rendererOptions: SigmaRendererOptions;

  constructor(options: SigmaRendererOptions = {}) {
    this.rendererOptions = options;
    this.piechartOptions = options.piechart ?? {};
  }

  // Bind the renderer adapter to a view container.
  mount(context: RenderContext): void {
    this.containerId = context.containerId;

    const container = document.getElementById(context.containerId);
    if (!container) {
      throw new Error(
        ERR_CONTAINER_NOT_FOUND.replace("{containerId}", context.containerId),
      );
    }

    this.containerElement = container;
    this.graph = new Graph();
    this.sigma = new Sigma(this.graph, this.containerElement, {
      renderLabels: this.rendererOptions.label?.enabled !== false,
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
    });
    this.sigma.getCamera().setState({ ratio: SIGMA_DEFAULT_CAMERA_ZOOM });
  }

  // Render positioned nodes and edges into Graphology then refresh Sigma.
  render(graph: PositionedGraph): void {
    if (!this.graph || !this.sigma) {
      throw new Error(ERR_SIGMA_NOT_READY);
    }

    // Clear previous frame first so Sigma rebuilds never see stale piechart nodes.
    this.graph.clear();
    this.ensureSigmaPiePrograms(graph);

    graph.nodes.forEach((node) => {
      const hasPieData = this.pieSliceKeys.some(
        (key) => toPositiveNumber(node.attributes?.[key]) > 0,
      );
      const nodeType =
        hasPieData && this.pieSliceKeys.length > 0
          ? SIGMA_NODE_TYPE_PIECHART
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

  // Drop container and graph references when renderer is detached.
  unmount(): void {
    this.sigma?.kill();
    this.sigma = null;
    this.graph = null;
    this.containerElement = null;
    this.containerId = null;
    this.pieSliceKeys = [];
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
    this.sigma?.kill();
    this.sigma = null;

    this.pieSliceKeys = sliceKeys;

    if (sliceKeys.length === 0) {
      this.sigma = new Sigma(
        this.graph as Graph,
        this.containerElement as HTMLElement,
        {
          renderLabels: this.rendererOptions.label?.enabled !== false,
          labelRenderedSizeThreshold:
            this.rendererOptions.label?.renderedSizeThreshold ??
            SIGMA_DEFAULT_LABEL_RENDERED_SIZE_THRESHOLD,
          labelDensity:
            this.rendererOptions.label?.density ?? SIGMA_DEFAULT_LABEL_DENSITY,
          labelGridCellSize:
            this.rendererOptions.label?.gridCellSize ??
            SIGMA_DEFAULT_LABEL_GRID_CELL_SIZE,
          labelColor: {
            color:
              this.rendererOptions.label?.color ?? SIGMA_DEFAULT_LABEL_COLOR,
          },
          labelSize:
            this.rendererOptions.label?.size ?? SIGMA_DEFAULT_LABEL_SIZE,
        },
      );
      this.sigma.getCamera().setState({ ratio: SIGMA_DEFAULT_CAMERA_ZOOM });
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
      {
        renderLabels: this.rendererOptions.label?.enabled !== false,
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
          [SIGMA_NODE_TYPE_PIECHART]: NodePiechartProgram,
        },
      },
    );
    this.sigma.getCamera().setState({ ratio: SIGMA_DEFAULT_CAMERA_ZOOM });
  }
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
