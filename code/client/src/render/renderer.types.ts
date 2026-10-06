import type { GraphNodeAttributes, PositionedGraph } from '../contracts/positioned';

export const RendererType = {
  Sigma: 'sigma',
  Mock: 'mock',
} as const;

export type RendererType = (typeof RendererType)[keyof typeof RendererType];

export interface RenderContext {
  readonly container: HTMLElement;
}

export interface RenderViewportState {
  readonly viewport: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly zoom: number;
}

export interface RenderViewportBounds {
  readonly xmin: number;
  readonly xmax: number;
  readonly ymin: number;
  readonly ymax: number;
}

export interface RenderViewportRequestState {
  /** Unpadded camera bounds for choosing detail; bounds may include a motion halo. */
  readonly selectionBounds?: RenderViewportBounds;
  /** Conservative CSS-pixel footprint including glyph clearance, if available. */
  readonly representationSpacingPx?: number;
  readonly bounds: RenderViewportBounds;
  readonly cameraRatio: number;
  /** CSS-pixel area used to select structural detail by visible complexity. */
  readonly pixelSize?: { readonly width: number; readonly height: number };
}

export interface RenderNodeClickState {
  readonly nodeId: string | null;
  readonly attributes?: GraphNodeAttributes;
}

// Internal renderer-neutral diagnostics descriptor. It deliberately exposes
// only real pointer hit coordinates, never renderer implementation objects.
export interface RenderInteractiveAggregateTarget {
  readonly clusterId: string;
  readonly representedNodeCount: number;
  readonly clientX: number;
  readonly clientY: number;
}

export interface GraphDisplayOptions {
  readonly nodeLabels?: boolean;
  readonly edgeDistanceLabels?: boolean;
  /** Auto retains the interactive zoom threshold; always shows enabled labels at every zoom. */
  readonly edgeDistanceLabelPolicy?: 'auto' | 'always';
  readonly distanceWeightedEdges?: boolean;
}

/** Publication export of the currently loaded slice and camera, without loading more detail.
 * Labels are forced at edge midpoints; collisions are not removed and viewport boundaries clip.
 * Dense trees may need a larger image, fewer edgeIds, or a different layout before exporting.
 * Scale multiplies viewport CSS dimensions (1–4); the optional slice legend adds height.
 */
export interface PngExportOptions {
  readonly scale?: number;
  /** Current follows the live label policy; all ignores zoom; none hides distances. */
  readonly edgeLabels?: 'current' | 'all' | 'none';
  /** Label only these edge IDs; geometry is preserved. Omit to include every distance. */
  readonly edgeIds?: readonly string[];
  /** Font size in logical pixels before scaling (6–72). */
  readonly edgeLabelSize?: number;
  readonly includeLegend?: boolean;
}

/** Arrangement only: a branch follows the loaded tree away from an explicit root.
 * The root is not biological. Dragging it moves its entire loaded component.
 * Missing roots and cyclic components cannot be dragged in branch mode.
 * Groups move only when a selected member is grabbed. Unloaded IDs are ignored.
 */
export type DragSelection =
  | { readonly kind: 'node' }
  | { readonly kind: 'branch'; readonly rootId: string }
  | { readonly kind: 'group'; readonly nodeIds: readonly string[] };

export interface GraphRenderer {
  setMotionEnabled?: (enabled: boolean) => void;
  isMotionEnabled?: () => boolean;
  setInteractionFeedbackHandler?: (handler: ((message: string) => void) | null) => void;
  setManipulationHandler?: (handler: ((active: boolean) => void) | null) => void;
  isManipulating?: () => boolean;
  getVisibleDisplacedNodeIds?: () => readonly string[];
  getDisplayedNodesInBounds?: (bounds: RenderViewportBounds) => readonly string[];
  setDragSelection?: (selection: DragSelection) => void;
  /** Restore server positions and single-node dragging. Edits are session-local, keyed by
   * rendered node ID: retained on reload/filter/expansion, cleared on a new dataset.
   * Children inherit a moved proxy's offset when expanded; collapse uses the children's mean offset.
   * Dragging is unrestricted; queries include measured display displacement plus a surrounding margin.
   * Off-screen history retains up to 20,000 nodes. Tier changes transition to server positions.
   * Reset pauses motion and restores server coordinates. Region selection uses the loaded display.
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

  getViewportState?: () => RenderViewportRequestState | null;

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
  createRenderer(type: RendererType): GraphRenderer;
}
