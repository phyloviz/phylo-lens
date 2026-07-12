import type Graph from "graphology";
import type Sigma from "sigma";
import {
  defaultCameraState,
  type GraphBounds,
  type SigmaCameraState,
  SIGMA_DEFAULT_CAMERA_ZOOM,
} from "./sigmaCamera";

export function applyStableCameraBounds(sigma: Sigma | null, coordinateBounds: GraphBounds | null): void {
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

export function restoreCameraState(sigma: Sigma | null, state: SigmaCameraState | null): void {
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
  nodeId,
  beforeSetState,
}: {
  graph: Graph | null;
  sigma: Sigma | null;
  nodeId: string;
  beforeSetState?: () => void;
}): boolean {
  if (!sigma || !graph?.hasNode(nodeId)) {
    return false;
  }

  const attributes = graph.getNodeAttributes(nodeId) as Record<string, unknown>;
  const nodeX = typeof attributes.x === "number" && Number.isFinite(attributes.x) ? attributes.x : null;
  const nodeY = typeof attributes.y === "number" && Number.isFinite(attributes.y) ? attributes.y : null;
  if (nodeX === null || nodeY === null) {
    return false;
  }

  return centerCameraOnCoordinates({
    sigma,
    x: nodeX,
    y: nodeY,
    beforeSetState,
  });
}

// Center the camera on raw graph coordinates without requiring the node to be
// present in the rendered graph. Used to focus a searched node that lives
// outside the current LoD slice: move the camera to where the node will be,
// then let a viewport re-fetch pull its slice in.
export function centerCameraOnCoordinates({
  sigma,
  x,
  y,
  beforeSetState,
}: {
  sigma: Sigma | null;
  x: number;
  y: number;
  beforeSetState?: () => void;
}): boolean {
  if (!sigma || !Number.isFinite(x) || !Number.isFinite(y)) {
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
  const viewportPoint = sigma.graphToViewport({ x, y });
  const nextCenter = sigma.viewportToFramedGraph(viewportPoint);

  beforeSetState?.();
  camera.setState({
    x: nextCenter.x,
    y: nextCenter.y,
    ratio:
      typeof currentState.ratio === "number" && Number.isFinite(currentState.ratio)
        ? currentState.ratio
        : SIGMA_DEFAULT_CAMERA_ZOOM,
  });
  return true;
}
