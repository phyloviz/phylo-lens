import type { PositionedGraph } from "../contracts/positioned";

export const RENDERER_KIND_SIGMA = "sigma";
export const RENDERER_KIND_MOCK = "mock";

export type RendererKind = typeof RENDERER_KIND_SIGMA | typeof RENDERER_KIND_MOCK;

export interface RenderContext {
  container: HTMLElement;
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

export interface RenderViewportBounds {
  xmin: number;
  xmax: number;
  ymin: number;
  ymax: number;
}

export interface RenderViewportSyncState {
  bounds: RenderViewportBounds;
  cameraRatio: number;
}

export interface RenderNodeClickState {
  nodeId: string | null;
  attributes?: Record<string, unknown>;
}

export interface GraphDisplayOptions {
  nodeLabels?: boolean;
  edgeDistanceLabels?: boolean;
  distanceWeightedEdges?: boolean;
}

export interface GraphRenderer {
  mount: (context: RenderContext) => void;
  unmount: () => void;
  render: (graph: PositionedGraph) => void;

  setViewChangeHandler?: (handler: ((state: RenderViewportState) => void) | null) => void;

  setNodeClickHandler?: (handler: ((state: RenderNodeClickState) => void) | null) => void;

  // Center the camera on a node already present in the rendered graph. Returns
  // true when it centered, false when the node is not in the current slice.
  centerOnNode?: (nodeId: string) => boolean;

  // Center the camera on raw graph coordinates without requiring the node to be
  // present in the rendered graph. Returns false when it could not move (no
  // sigma/bounds or non-finite coordinates).
  centerOnCoordinates?: (x: number, y: number) => boolean;

  focusNode?: (nodeId: string | null) => void;

  updateDisplayOptions?: (options: GraphDisplayOptions) => void;

  getViewportSyncState?: () => RenderViewportSyncState | null;

  applyGraphSnapshot?: (graph: PositionedGraph) => void;

  fitGraphSnapshot?: (
    graph: PositionedGraph,
    options?: { resetFirst?: boolean },
  ) => ReturnType<typeof window.setTimeout> | null;

  // Enable/disable region (box) selection mode. While enabled a plain drag on
  // the canvas draws a selection box; Shift+drag works regardless of the toggle.
  setRegionSelectModeEnabled?: (enabled: boolean) => void;

  // Register a handler invoked with graph-space bounds when the user completes
  // a box-select drag.
  setRegionSelectedHandler?: (handler: ((bounds: RenderViewportBounds) => void) | null) => void;

  setNodeDoubleClickHandler?: (handler: ((state: RenderNodeClickState) => void) | null) => void;

  // Highlight a set of node ids on the canvas by dimming everything outside it.
  // Passing an empty set (or null) clears the highlight.
  setHighlightedNodes?: (nodeIds: ReadonlySet<string> | null) => void;
}

export interface RendererFactory {
  createRenderer(kind: RendererKind): GraphRenderer;
}
