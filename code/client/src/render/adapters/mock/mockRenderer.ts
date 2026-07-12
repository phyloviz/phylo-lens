import type { PositionedGraph } from "../../../contracts/positioned";
import {
  type GraphRenderer,
  RENDERER_KIND_MOCK,
  type RenderContext,
  type RenderNodeClickState,
  type RendererKind,
  type RenderViewportState,
} from "../../renderer.types";

export const MOCK_RENDERER_EMPTY_CONTAINER = "";

// Mock renderer adapter supports testing and local dry-runs without Sigma runtime.
export default function () {
  let containerId: string = MOCK_RENDERER_EMPTY_CONTAINER;
  let lastGraph: PositionedGraph | null = null;
  let lastCenteredNodeId: string | null = null;
  let lastCenteredCoordinates: { x: number; y: number } | null = null;
  let lastFocusedNodeId: string | null = null;
  let viewChangeHandler: ((state: RenderViewportState) => void) | null = null;
  let nodeClickHandler: ((state: RenderNodeClickState) => void) | null = null;

  return {
    kind: RENDERER_KIND_MOCK as RendererKind,
    mount: mount,
    render: render,
    setViewChangeHandler: setViewChangeHandler,
    setNodeClickHandler: setNodeClickHandler,
    centerOnNode: centerOnNode,
    centerOnCoordinates: centerOnCoordinates,
    focusNode: focusNode,
    unmount: unmount,
    getRenderedGraph: getRenderedGraph,
    getMountedContainerId: getMountedContainerId,
    getLastCenteredNodeId: getLastCenteredNodeId,
    getLastCenteredCoordinates: getLastCenteredCoordinates,
    getLastFocusedNodeId: getLastFocusedNodeId,
    emitViewChange: emitViewChange,
    emitNodeClick: emitNodeClick,
  } satisfies GraphRenderer & {
    kind: RendererKind;
    getRenderedGraph: typeof getRenderedGraph;
    getMountedContainerId: typeof getMountedContainerId;
    getLastCenteredNodeId: typeof getLastCenteredNodeId;
    getLastCenteredCoordinates: typeof getLastCenteredCoordinates;
    getLastFocusedNodeId: typeof getLastFocusedNodeId;
    emitViewChange: typeof emitViewChange;
    emitNodeClick: typeof emitNodeClick;
  };

  // Bind the mock renderer to a container identifier.
  function mount(context: RenderContext): void {
    containerId = context.containerId;
    lastGraph = null;
    lastCenteredNodeId = null;
    lastCenteredCoordinates = null;
    lastFocusedNodeId = null;
  }

  // Store rendered graph snapshot for assertions and debug checks.
  function render(graph: PositionedGraph): void {
    lastGraph = graph;
  }

  function setViewChangeHandler(handler: ((state: RenderViewportState) => void) | null): void {
    viewChangeHandler = handler;
  }

  function setNodeClickHandler(handler: ((state: RenderNodeClickState) => void) | null): void {
    nodeClickHandler = handler;
  }

  function centerOnNode(nodeId: string): boolean {
    lastCenteredNodeId = nodeId;
    return true;
  }

  function centerOnCoordinates(x: number, y: number): boolean {
    lastCenteredCoordinates = { x, y };
    return true;
  }

  function focusNode(nodeId: string | null): void {
    lastFocusedNodeId = nodeId;
  }

  // Reset internal references on renderer teardown.
  function unmount(): void {
    containerId = MOCK_RENDERER_EMPTY_CONTAINER;
    lastGraph = null;
    lastCenteredNodeId = null;
    lastFocusedNodeId = null;
    viewChangeHandler = null;
    nodeClickHandler = null;
  }

  // Expose the last rendered graph for tests and diagnostics.
  function getRenderedGraph(): PositionedGraph | null {
    return lastGraph;
  }

  function getMountedContainerId(): string {
    return containerId;
  }

  function getLastCenteredNodeId(): string | null {
    return lastCenteredNodeId;
  }

  function getLastCenteredCoordinates(): { x: number; y: number } | null {
    return lastCenteredCoordinates;
  }

  function getLastFocusedNodeId(): string | null {
    return lastFocusedNodeId;
  }

  function emitViewChange(state: RenderViewportState): void {
    viewChangeHandler?.(state);
  }

  function emitNodeClick(state: RenderNodeClickState): void {
    nodeClickHandler?.(state);
  }
}
