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

// Internal renderer-neutral diagnostics descriptor. It deliberately exposes
// only real pointer hit coordinates, never renderer implementation objects.
export interface RenderInteractiveAggregateTarget {
  clusterId: string;
  representedNodeCount: number;
  clientX: number;
  clientY: number;
}

export interface GraphDisplayOptions {
  nodeLabels?: boolean;
  edgeDistanceLabels?: boolean;
  /** Auto retains the interactive zoom threshold; always shows enabled labels at every zoom. */
  edgeDistanceLabelPolicy?: "auto" | "always";
  distanceWeightedEdges?: boolean;
}

/** Publication export of the currently loaded slice and camera, without loading more detail.
 * Labels are forced at edge midpoints; collisions are not removed and viewport boundaries clip.
 * Dense trees may need a larger image, fewer edgeIds, or a different layout before exporting.
 * Scale multiplies viewport CSS dimensions (1–4); the optional slice legend adds height.
 */
export interface PngExportOptions {
  scale?: number;
  /** Current follows the live label policy; all ignores zoom; none hides distances. */
  edgeLabels?: "current" | "all" | "none";
  /** Label only these edge IDs; geometry is preserved. Omit to include every distance. */
  edgeIds?: readonly string[];
  /** Font size in logical pixels before scaling (6–72). */
  edgeLabelSize?: number;
  includeLegend?: boolean;
}

/** Arrangement only: a branch follows the loaded tree away from an explicit root.
 * The root is not biological. Dragging it moves its entire loaded component.
 * Missing roots and cyclic components cannot be dragged in branch mode.
 * Groups move only when a selected member is grabbed. Unloaded IDs are ignored.
 */
export type DragSelection =
  { kind: "node" } | { kind: "branch"; rootId: string } | { kind: "group"; nodeIds: readonly string[] };

export interface GraphRenderer {
  setDragSelection?: (selection: DragSelection) => void;
  /** Restore server positions and single-node dragging. Edits are session-local, keyed by
   * rendered node ID: retained on reload/filter/expansion, cleared on a new dataset.
   * Proxies and their children have separate positions; hidden children do not inherit moves.
   * Viewport queries still use server coordinates. Expand/fix detail before arranging a branch.
   */
  resetLayoutEdits?: () => void;
  mount: (context: RenderContext) => void;
  unmount: () => void;
  render: (graph: PositionedGraph) => void;

  // Return a PNG of the currently materialized renderer view. It must preserve
  // the active camera and graph rather than fitting, reloading, or mutating it.
  exportPng?: (options?: PngExportOptions) => Promise<Blob>;

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

  applyGraphSnapshot?: (graph: PositionedGraph, options?: { preservePositions?: boolean }) => void;

  getInteractiveAggregateTargets?: () => readonly RenderInteractiveAggregateTarget[];

  // Returns a cancellation function for pending and active camera motion.
  fitGraphSnapshot?: (graph: PositionedGraph, options?: { resetFirst?: boolean }) => (() => void) | null;

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
