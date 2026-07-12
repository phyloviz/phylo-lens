import type { PositionedGraphBounds } from "../../../../contracts/positioned";
import type { RenderViewportState } from "../../../renderer.types";

export const SIGMA_DEFAULT_CAMERA_ZOOM = 1;
export const SIGMA_MIN_CAMERA_RATIO = 0.002;
export const SIGMA_MAX_CAMERA_RATIO = 10;
export const SIGMA_MAX_LOD_ZOOM = 8;
export const SIGMA_ZOOMING_RATIO = 1.15;
export const SIGMA_DEFAULT_CAMERA_X = 0.5;
export const SIGMA_DEFAULT_CAMERA_Y = 0.5;
export const SIGMA_EDGE_LABEL_MAX_CAMERA_RATIO = 0.5;

export interface GraphBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface SigmaCameraState {
  x?: number;
  y?: number;
  ratio?: number;
}

export interface SigmaSemanticViewState {
  camera: {
    x: number;
    y: number;
    ratio: number;
  };
  viewport: RenderViewportState["viewport"];
  lodZoom: number;
  edgeDistanceLabelsVisible: boolean;
}

export function defaultCameraState(): { x: number; y: number; ratio: number } {
  return {
    x: SIGMA_DEFAULT_CAMERA_X,
    y: SIGMA_DEFAULT_CAMERA_Y,
    ratio: SIGMA_DEFAULT_CAMERA_ZOOM,
  };
}

export function sigmaRatioToLodZoom(ratio: number): number {
  if (!Number.isFinite(ratio) || ratio <= 0) {
    return 0.5;
  }

  const zoom = 1 + Math.log2(1 / ratio);
  return Math.min(SIGMA_MAX_LOD_ZOOM, Math.max(0.5, zoom));
}

export function sigmaCameraToViewportState(
  bounds: GraphBounds,
  camera: SigmaCameraState,
): RenderViewportState["viewport"] {
  return sigmaNormalizedCameraToViewportState(bounds, normalizeSigmaCameraState(camera));
}

export function sigmaCameraToSemanticViewState(bounds: GraphBounds, camera: SigmaCameraState): SigmaSemanticViewState {
  const normalizedCamera = normalizeSigmaCameraState(camera);

  return {
    camera: normalizedCamera,
    viewport: sigmaNormalizedCameraToViewportState(bounds, normalizedCamera),
    lodZoom: sigmaRatioToLodZoom(normalizedCamera.ratio),
    edgeDistanceLabelsVisible: normalizedCamera.ratio <= SIGMA_EDGE_LABEL_MAX_CAMERA_RATIO,
  };
}

export function normalizeSigmaCameraState(camera: SigmaCameraState): {
  x: number;
  y: number;
  ratio: number;
} {
  return {
    x: clampUnit(camera.x ?? SIGMA_DEFAULT_CAMERA_X),
    y: clampUnit(camera.y ?? SIGMA_DEFAULT_CAMERA_Y),
    ratio:
      typeof camera.ratio === "number" && Number.isFinite(camera.ratio)
        ? Math.max(camera.ratio, SIGMA_MIN_CAMERA_RATIO)
        : SIGMA_DEFAULT_CAMERA_ZOOM,
  };
}

export function graphCoordinatesToCameraCenter(
  bounds: GraphBounds,
  point: { x: number; y: number },
): { x: number; y: number } {
  const spanX = Math.max(bounds.maxX - bounds.minX, 1);
  const spanY = Math.max(bounds.maxY - bounds.minY, 1);

  return {
    x: clampUnit((point.x - bounds.minX) / spanX),
    y: clampUnit((point.y - bounds.minY) / spanY),
  };
}

export function normalizeGraphBounds(bounds: PositionedGraphBounds | undefined): GraphBounds | null {
  if (!bounds) {
    return null;
  }

  if (
    !Number.isFinite(bounds.minX) ||
    !Number.isFinite(bounds.maxX) ||
    !Number.isFinite(bounds.minY) ||
    !Number.isFinite(bounds.maxY)
  ) {
    return null;
  }

  return bounds;
}

export function deriveGraphBounds(nodes: readonly { x: number; y: number }[]): GraphBounds | null {
  if (nodes.length === 0) {
    return null;
  }

  let minX = nodes[0]?.x ?? 0;
  let maxX = minX;
  let minY = nodes[0]?.y ?? 0;
  let maxY = minY;

  nodes.forEach((node) => {
    minX = Math.min(minX, node.x);
    maxX = Math.max(maxX, node.x);
    minY = Math.min(minY, node.y);
    maxY = Math.max(maxY, node.y);
  });

  return { minX, maxX, minY, maxY };
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) {
    return 0.5;
  }
  return Math.min(1, Math.max(0, value));
}

function sigmaNormalizedCameraToViewportState(
  bounds: GraphBounds,
  camera: { x: number; y: number; ratio: number },
): RenderViewportState["viewport"] {
  const spanX = Math.max(bounds.maxX - bounds.minX, 1);
  const spanY = Math.max(bounds.maxY - bounds.minY, 1);

  return {
    x: bounds.minX + camera.x * spanX,
    y: bounds.minY + camera.y * spanY,
    width: spanX * camera.ratio,
    height: spanY * camera.ratio,
  };
}
