import type { PositionedGraph } from "../contracts/positioned";

export const RENDERER_KIND_SIGMA = "sigma";
export const RENDERER_KIND_MOCK = "mock";

export type RendererKind =
  | typeof RENDERER_KIND_SIGMA
  | typeof RENDERER_KIND_MOCK;

export interface RenderContext {
  containerId: string;
}

export interface RenderViewportState {
  viewport: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  zoom: number;
}

export interface RenderNodeClickState {
  nodeId: string;
  attributes?: Record<string, unknown>;
}

export interface GraphRenderer {
  mount: (context: RenderContext) => void;
  unmount: () => void;
  render: (graph: PositionedGraph) => void;

  setViewChangeHandler?: (
    handler: ((state: RenderViewportState) => void) | null,
  ) => void;

  setNodeClickHandler?: (
    handler: ((state: RenderNodeClickState) => void) | null,
  ) => void;

  centerOnNode?: (nodeId: string) => void;
}

export interface RendererFactory {
  createRenderer(kind: RendererKind): GraphRenderer;
}
