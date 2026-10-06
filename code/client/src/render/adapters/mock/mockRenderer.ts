import type { PositionedGraph } from '../../../contracts/positioned';
import {
  type GraphRenderer,
  RendererType,
  type RenderContext,
  type RenderNodeClickState,
  type RenderViewportRequestState,
  type RenderViewportState,
} from '../../renderer.types';

export const MOCK_RENDERER_EMPTY_CONTAINER = '';

// Mock renderer adapter supports testing and local dry-runs without Sigma runtime.
export default function () {
  let container: HTMLElement | null = null;
  let lastGraph: PositionedGraph | null = null;
  let lastCenteredNodeId: string | null = null;
  let lastCenteredCoordinates: { x: number; y: number } | null = null;
  let lastFocusedNodeId: string | null = null;
  let viewChangeHandler: ((state: RenderViewportState) => void) | null = null;
  let nodeClickHandler: ((state: RenderNodeClickState) => void) | null = null;
  let nodeDoubleClickHandler: ((state: RenderNodeClickState) => void) | null = null;
  let viewportState: RenderViewportRequestState | null = {
    bounds: { xmin: 0, xmax: 100, ymin: 0, ymax: 100 },
    cameraRatio: 1,
  };

  return {
    kind: RendererType.Mock,
    mount: mount,
    render: render,
    setViewChangeHandler: setViewChangeHandler,
    setNodeClickHandler: setNodeClickHandler,
    centerOnNode: centerOnNode,
    centerOnCoordinates: centerOnCoordinates,
    focusNode: focusNode,
    getViewportState: getViewportState,
    applyGraphSnapshot: render,
    fitGraphSnapshot: fitGraphSnapshot,
    setNodeDoubleClickHandler: setNodeDoubleClickHandler,
    unmount: unmount,
    getRenderedGraph: getRenderedGraph,
    getMountedContainerId: getMountedContainerId,
    getLastCenteredNodeId: getLastCenteredNodeId,
    getLastCenteredCoordinates: getLastCenteredCoordinates,
    getLastFocusedNodeId: getLastFocusedNodeId,
    setViewportState: setViewportState,
    emitViewChange: emitViewChange,
    emitNodeClick: emitNodeClick,
    emitNodeDoubleClick: emitNodeDoubleClick,
  } satisfies GraphRenderer & {
    kind: RendererType;
    getRenderedGraph: typeof getRenderedGraph;
    getMountedContainerId: typeof getMountedContainerId;
    getLastCenteredNodeId: typeof getLastCenteredNodeId;
    getLastCenteredCoordinates: typeof getLastCenteredCoordinates;
    getLastFocusedNodeId: typeof getLastFocusedNodeId;
    setViewportState: typeof setViewportState;
    emitViewChange: typeof emitViewChange;
    emitNodeClick: typeof emitNodeClick;
    emitNodeDoubleClick: typeof emitNodeDoubleClick;
  };

  // Bind the mock renderer to a container identifier.
  function mount(context: RenderContext): void {
    container = context.container;
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

  function getViewportState(): RenderViewportRequestState | null {
    return viewportState;
  }

  function setViewportState(state: RenderViewportRequestState | null): void {
    viewportState = state;
  }

  function fitGraphSnapshot(): null {
    return null;
  }

  function setNodeDoubleClickHandler(handler: ((state: RenderNodeClickState) => void) | null): void {
    nodeDoubleClickHandler = handler;
  }

  // Reset internal references on renderer teardown.
  function unmount(): void {
    container = null;
    lastGraph = null;
    lastCenteredNodeId = null;
    lastCenteredCoordinates = null;
    lastFocusedNodeId = null;
    viewChangeHandler = null;
    nodeClickHandler = null;
    nodeDoubleClickHandler = null;
  }

  // Expose the last rendered graph for tests and diagnostics.
  function getRenderedGraph(): PositionedGraph | null {
    return lastGraph;
  }

  function getMountedContainerId(): string {
    return container?.id ?? MOCK_RENDERER_EMPTY_CONTAINER;
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

  function emitNodeDoubleClick(state: RenderNodeClickState): void {
    nodeDoubleClickHandler?.(state);
  }
}
