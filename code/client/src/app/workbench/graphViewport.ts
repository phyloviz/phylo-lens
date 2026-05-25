import { type Viewport } from "../../contracts/models";
import { type PositionedGraph } from "../../contracts/positioned";

export const DEFAULT_VIEW_SLICE_ZOOM = 1;
export const DEFAULT_VIEW_SLICE_MAX_NODES = 6000;
export const DEFAULT_VIEW_CHANGE_DEBOUNCE_MS = 180;
export const DEFAULT_RENDER_VIEW_SUPPRESSION_MS = 450;
export const MAX_DYNAMIC_VIEW_SLICE_NODES = 12_010;

export const DEFAULT_VIEWPORT: Viewport = {
  x: 0,
  y: 0,
  width: 1000,
  height: 600,
};

export function serializeViewKey(
  viewport: Viewport,
  zoom: number,
  maxNodes: number,
  lodHint?: number,
  focusNodeId?: string,
  focusClusterId?: string,
  expandedClusterIds: readonly string[] = [],
  collapsedClusterIds: readonly string[] = [],
): string {
  return JSON.stringify({
    viewport,
    zoom,
    maxNodes,
    lodHint,
    focusNodeId,
    focusClusterId,
    expandedClusterIds: [...expandedClusterIds].sort(),
    collapsedClusterIds: [...collapsedClusterIds].sort(),
  });
}

export function normalizeViewport(viewport: Viewport): Viewport {
  return {
    x: viewport.x,
    y: viewport.y,
    width: viewport.width > 0 ? viewport.width : DEFAULT_VIEWPORT.width,
    height: viewport.height > 0 ? viewport.height : DEFAULT_VIEWPORT.height,
  };
}

export function normalizeZoom(zoom: number): number {
  if (!Number.isFinite(zoom) || zoom < 0) {
    return DEFAULT_VIEW_SLICE_ZOOM;
  }

  return zoom;
}

export function resolveMaxNodesForZoom(
  baseMaxNodes: number,
  zoom: number,
): number {
  if (!Number.isFinite(zoom) || zoom <= DEFAULT_VIEW_SLICE_ZOOM) {
    return baseMaxNodes;
  }

  const zoomFactor = 1 + (zoom - DEFAULT_VIEW_SLICE_ZOOM) * 0.5;

  return Math.min(
    MAX_DYNAMIC_VIEW_SLICE_NODES,
    Math.max(baseMaxNodes, Math.round(baseMaxNodes * zoomFactor)),
  );
}

export function recenterViewportOnNode(
  viewport: Viewport,
  node: PositionedGraph["nodes"][number] | undefined,
): Viewport {
  if (!node) {
    return viewport;
  }

  return {
    ...viewport,
    x: node.x,
    y: node.y,
  };
}
