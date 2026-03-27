import { PositionedGraph } from "../contracts/positioned";

export const RENDERER_KIND_SIGMA = "sigma";
export const RENDERER_KIND_MOCK = "mock";

export type RendererKind =
  | typeof RENDERER_KIND_SIGMA
  | typeof RENDERER_KIND_MOCK;

export interface RenderContext {
  containerId: string;
}

export interface GraphRenderer {
  kind: RendererKind;

  // Mount renderer resources into the given container context.
  mount(context: RenderContext): void;

  // Render a positioned graph through the renderer implementation.
  render(graph: PositionedGraph): void;

  // Release resources and detach renderer from the view.
  unmount(): void;
}

export interface RendererFactory {
  createRenderer(kind: RendererKind): GraphRenderer;
}
