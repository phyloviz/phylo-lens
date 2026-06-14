import type { PositionedGraph } from "../../contracts/positioned";
import {
  type GraphRenderer,
  RENDERER_KIND_MOCK,
  type RenderContext,
  type RenderNodeClickState,
  type RendererKind,
  type RenderViewportState,
} from "../types";

export const MOCK_RENDERER_EMPTY_CONTAINER = "";

// Mock renderer adapter supports testing and local dry-runs without Sigma runtime.
export class MockRenderer implements GraphRenderer {
  readonly kind: RendererKind = RENDERER_KIND_MOCK;

  private containerId: string = MOCK_RENDERER_EMPTY_CONTAINER;
  private lastGraph: PositionedGraph | null = null;
  private lastCenteredNodeId: string | null = null;
  private lastFocusedNodeId: string | null = null;
  private viewChangeHandler: ((state: RenderViewportState) => void) | null =
    null;
  private nodeClickHandler: ((state: RenderNodeClickState) => void) | null =
    null;

  // Bind the mock renderer to a container identifier.
  mount(context: RenderContext): void {
    this.containerId = context.containerId;
    this.lastGraph = null;
    this.lastCenteredNodeId = null;
    this.lastFocusedNodeId = null;
  }

  // Store rendered graph snapshot for assertions and debug checks.
  render(graph: PositionedGraph): void {
    this.lastGraph = graph;
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
    this.lastCenteredNodeId = nodeId;
  }

  focusNode(nodeId: string | null): void {
    this.lastFocusedNodeId = nodeId;
  }

  // Reset internal references on renderer teardown.
  unmount(): void {
    this.containerId = MOCK_RENDERER_EMPTY_CONTAINER;
    this.lastGraph = null;
    this.lastCenteredNodeId = null;
    this.lastFocusedNodeId = null;
    this.viewChangeHandler = null;
    this.nodeClickHandler = null;
  }

  // Expose the last rendered graph for tests and diagnostics.
  getRenderedGraph(): PositionedGraph | null {
    return this.lastGraph;
  }

  getMountedContainerId(): string {
    return this.containerId;
  }

  getLastCenteredNodeId(): string | null {
    return this.lastCenteredNodeId;
  }

  getLastFocusedNodeId(): string | null {
    return this.lastFocusedNodeId;
  }

  emitViewChange(state: RenderViewportState): void {
    this.viewChangeHandler?.(state);
  }

  emitNodeClick(state: RenderNodeClickState): void {
    this.nodeClickHandler?.(state);
  }
}
