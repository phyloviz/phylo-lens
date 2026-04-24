import { PositionedGraph } from "../contracts/positioned";

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

export interface GraphRenderer {
  kind: RendererKind;

  // Mount renderer resources into the given container context.
  mount(context: RenderContext): void;

  // Render a positioned graph through the renderer implementation.
  render(graph: PositionedGraph): void;

  // Subscribe to renderer camera/view changes when supported.
  setViewChangeHandler?(
    handler: ((state: RenderViewportState) => void) | null,
  ): void;

  // Release resources and detach renderer from the view.
  unmount(): void;
}

export interface RendererFactory {
  createRenderer(kind: RendererKind): GraphRenderer;
}
