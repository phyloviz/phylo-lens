import type { GraphViewportResponse } from "../../../../api/graphContracts";
import { sigmaDimensions } from "./graphViewportQuery";
import type { SigmaViewportBounds, SigmaViewportLike } from "./graphViewport.types";

export const GRAPH_VIEWER_FIT_PADDING_RATIO = 1.15;
export const GRAPH_VIEWER_INITIAL_FIT_DELAY_MS = 50;
export const GRAPH_VIEWER_INITIAL_FIT_DURATION_MS = 300;
export const GRAPH_VIEWER_FOCUS_ZOOM_OUT_DURATION_MS = 140;
export const GRAPH_VIEWER_MIN_FOCUS_FIT_RATIO = 0.02;
export const GRAPH_VIEWER_CLUSTER_FIT_PADDING_RATIO = 1.35;
export const GRAPH_VIEWER_CLUSTER_FIT_DURATION_MS = 350;

export function fitSigmaToViewportResponse(
  sigma: SigmaViewportLike,
  response: GraphViewportResponse,
  options: { resetFirst?: boolean } = {},
): ReturnType<typeof window.setTimeout> | null {
  if (response.nodes.length === 0) {
    return null;
  }
  sigma.refresh?.();
  const camera = sigma.getCamera();
  const target = cameraTargetForResponse(sigma, response, GRAPH_VIEWER_FIT_PADDING_RATIO);

  if (options.resetFirst === false) {
    return animateCameraToTarget(sigma, target, GRAPH_VIEWER_INITIAL_FIT_DURATION_MS);
  }

  return window.setTimeout(() => {
    sigma.refresh?.();
    if (camera.animatedReset) {
      camera.animatedReset({
        duration: GRAPH_VIEWER_INITIAL_FIT_DURATION_MS,
      });
      window.setTimeout(() => {
        const state = camera.getState?.();
        if (!state || typeof state.ratio !== "number" || !camera.animate) {
          return;
        }
        camera.animate(
          {
            x: state.x ?? target.x,
            y: state.y ?? target.y,
            ratio: Math.max(state.ratio * GRAPH_VIEWER_FIT_PADDING_RATIO, Number.EPSILON),
          },
          { duration: 100 },
        );
      }, GRAPH_VIEWER_INITIAL_FIT_DURATION_MS);
      return;
    }
    void animateCameraToTarget(sigma, target, GRAPH_VIEWER_INITIAL_FIT_DURATION_MS);
  }, GRAPH_VIEWER_INITIAL_FIT_DELAY_MS);
}

export function fitSigmaToClusterResponse(sigma: SigmaViewportLike, response: GraphViewportResponse): void {
  if (response.nodes.length === 0) {
    return;
  }
  sigma.refresh?.();
  sigma
    .getCamera()
    .animate?.(cameraTargetForResponse(sigma, response, GRAPH_VIEWER_CLUSTER_FIT_PADDING_RATIO), {
      duration: GRAPH_VIEWER_CLUSTER_FIT_DURATION_MS,
    });
}

function animateCameraToTarget(
  sigma: SigmaViewportLike,
  target: { x: number; y: number; ratio: number },
  durationMs: number,
): ReturnType<typeof window.setTimeout> | null {
  const camera = sigma.getCamera();
  const state = camera.getState?.();
  if (!camera.animate || !state || typeof state.x !== "number" || typeof state.y !== "number") {
    camera.animate?.(target, { duration: durationMs });
    return null;
  }

  const currentRatio =
    typeof state.ratio === "number" && Number.isFinite(state.ratio) ? state.ratio : target.ratio;
  if (!shouldStageFocusAnimation(state, target, currentRatio)) {
    camera.animate(target, { duration: durationMs });
    return null;
  }

  const zoomOutTarget = {
    x: state.x,
    y: state.y,
    ratio: stagedZoomOutRatio(currentRatio, target.ratio),
  };
  camera.animate(zoomOutTarget, { duration: GRAPH_VIEWER_FOCUS_ZOOM_OUT_DURATION_MS });
  return window.setTimeout(() => {
    camera.animate?.(target, {
      duration: Math.max(durationMs - GRAPH_VIEWER_FOCUS_ZOOM_OUT_DURATION_MS, 100),
    });
  }, GRAPH_VIEWER_FOCUS_ZOOM_OUT_DURATION_MS);
}

function shouldStageFocusAnimation(
  state: { x?: number; y?: number },
  target: { x: number; y: number; ratio: number },
  currentRatio: number,
): boolean {
  if (!Number.isFinite(currentRatio) || !Number.isFinite(target.ratio)) {
    return false;
  }
  const dx = target.x - (state.x ?? target.x);
  const dy = target.y - (state.y ?? target.y);
  const farFromTarget = Math.hypot(dx, dy) > 1;
  return currentRatio < 0.05 && farFromTarget;
}

function stagedZoomOutRatio(currentRatio: number, targetRatio: number): number {
  return Math.max(currentRatio * 3, targetRatio * 0.75, Number.EPSILON);
}

function responseBounds(response: GraphViewportResponse): SigmaViewportBounds {
  const xs = response.nodes.map((node) => node.x);
  const ys = response.nodes.map((node) => node.y);
  return {
    xmin: Math.min(...xs),
    xmax: Math.max(...xs),
    ymin: Math.min(...ys),
    ymax: Math.max(...ys),
  };
}

function cameraTargetForResponse(
  sigma: SigmaViewportLike,
  response: GraphViewportResponse,
  paddingRatio: number,
): { x: number; y: number; ratio: number } {
  const bounds = responseBounds(response);
  const center = graphPointToFramedGraph(sigma, {
    x: (bounds.xmin + bounds.xmax) / 2,
    y: (bounds.ymin + bounds.ymax) / 2,
  });
  const ratio = cameraRatioForResponse(sigma, response, center, paddingRatio);
  return {
    x: center.x,
    y: center.y,
    ratio,
  };
}

function cameraRatioForResponse(
  sigma: SigmaViewportLike,
  response: GraphViewportResponse,
  center: { x: number; y: number },
  paddingRatio: number,
): number {
  const dimensions = sigmaDimensions(sigma);
  const camera = sigma.getCamera();
  const cameraState = camera.getState?.() ?? camera;
  const currentRatio =
    typeof cameraState.ratio === "number" && Number.isFinite(cameraState.ratio) ? cameraState.ratio : 1;
  const viewportPoints = response.nodes.map((node) =>
    sigma.graphToViewport(
      { x: node.x, y: node.y },
      {
        cameraState: {
          ...cameraState,
          x: center.x,
          y: center.y,
          ratio: currentRatio,
        },
      },
    ),
  );
  const xs = viewportPoints.map((point) => point.x);
  const ys = viewportPoints.map((point) => point.y);
  const viewportWidth = Math.max(Math.max(...xs) - Math.min(...xs), 1);
  const viewportHeight = Math.max(Math.max(...ys) - Math.min(...ys), 1);
  const scale = Math.max(
    (viewportWidth * paddingRatio) / Math.max(dimensions.width, 1),
    (viewportHeight * paddingRatio) / Math.max(dimensions.height, 1),
    Number.EPSILON,
  );
  return Math.max(currentRatio * scale, GRAPH_VIEWER_MIN_FOCUS_FIT_RATIO, Number.EPSILON);
}

function graphPointToFramedGraph(
  sigma: SigmaViewportLike,
  point: { x: number; y: number },
): { x: number; y: number } {
  return sigma.viewportToFramedGraph(sigma.graphToViewport(point));
}
