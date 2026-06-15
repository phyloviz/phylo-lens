import type Graph from "graphology";
import type Sigma from "sigma";
import {
  defaultCameraState,
  graphCoordinatesToCameraCenter,
  type GraphBounds,
  SIGMA_DEFAULT_CAMERA_ZOOM,
} from "./sigmaCamera";

export interface SigmaCameraState {
  x?: number;
  y?: number;
  ratio?: number;
}

export function applyStableCameraBounds(
  sigma: Sigma | null,
  coordinateBounds: GraphBounds | null,
): void {
  if (!sigma) {
    return;
  }

  sigma.setCustomBBox(
    coordinateBounds
      ? {
          x: [coordinateBounds.minX, coordinateBounds.maxX],
          y: [coordinateBounds.minY, coordinateBounds.maxY],
        }
      : null,
  );
}

export function readCameraState(sigma: Sigma | null): SigmaCameraState | null {
  if (!sigma) {
    return null;
  }

  const camera = sigma.getCamera() as {
    getState?: () => SigmaCameraState;
  };
  return camera.getState?.() ?? null;
}

export function restoreCameraState(
  sigma: Sigma | null,
  state: SigmaCameraState | null,
): void {
  if (!sigma) {
    return;
  }

  const camera = sigma.getCamera() as {
    setState: (state: SigmaCameraState) => void;
  };
  camera.setState(state ?? defaultCameraState());
}

export function centerCameraOnGraphNode({
  graph,
  sigma,
  coordinateBounds,
  nodeId,
  beforeSetState,
}: {
  graph: Graph | null;
  sigma: Sigma | null;
  coordinateBounds: GraphBounds | null;
  nodeId: string;
  beforeSetState?: () => void;
}): boolean {
  if (!sigma || !coordinateBounds || !graph?.hasNode(nodeId)) {
    return false;
  }

  const attributes = graph.getNodeAttributes(nodeId) as Record<
    string,
    unknown
  >;
  const nodeX =
    typeof attributes.x === "number" && Number.isFinite(attributes.x)
      ? attributes.x
      : null;
  const nodeY =
    typeof attributes.y === "number" && Number.isFinite(attributes.y)
      ? attributes.y
      : null;
  if (nodeX === null || nodeY === null) {
    return false;
  }

  const camera = sigma.getCamera() as {
    x?: number;
    y?: number;
    ratio?: number;
    getState?: () => SigmaCameraState;
    setState: (state: SigmaCameraState) => void;
  };
  const currentState = camera.getState?.() ?? camera;
  const nextCenter = graphCoordinatesToCameraCenter(coordinateBounds, {
    x: nodeX,
    y: nodeY,
  });

  beforeSetState?.();
  camera.setState({
    x: nextCenter.x,
    y: nextCenter.y,
    ratio:
      typeof currentState.ratio === "number" &&
      Number.isFinite(currentState.ratio)
        ? currentState.ratio
        : SIGMA_DEFAULT_CAMERA_ZOOM,
  });
  return true;
}
