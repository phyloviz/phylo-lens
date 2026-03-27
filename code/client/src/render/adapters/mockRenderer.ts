import { PositionedGraph } from "../../contracts/positioned";
import {
  GraphRenderer,
  RENDERER_KIND_MOCK,
  RenderContext,
  RendererKind,
} from "../types";

export const MOCK_RENDERER_EMPTY_CONTAINER = "";

// Mock renderer adapter supports testing and local dry-runs without Sigma runtime.
export class MockRenderer implements GraphRenderer {
  readonly kind: RendererKind = RENDERER_KIND_MOCK;

  private containerId: string = MOCK_RENDERER_EMPTY_CONTAINER;
  private lastGraph: PositionedGraph | null = null;

  // Bind the mock renderer to a container identifier.
  mount(context: RenderContext): void {
    this.containerId = context.containerId;
  }

  // Store rendered graph snapshot for assertions and debug checks.
  render(graph: PositionedGraph): void {
    this.lastGraph = graph;
  }

  // Reset internal references on renderer teardown.
  unmount(): void {
    this.containerId = MOCK_RENDERER_EMPTY_CONTAINER;
    this.lastGraph = null;
  }

  // Expose the last rendered graph for tests and diagnostics.
  getRenderedGraph(): PositionedGraph | null {
    return this.lastGraph;
  }
}
