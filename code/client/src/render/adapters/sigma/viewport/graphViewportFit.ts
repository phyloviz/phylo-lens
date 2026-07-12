import type { GraphViewportResponse } from "../../../../api/graphContracts";
import { sigmaDimensions } from "./graphViewportQuery";
import type { SigmaViewportBounds, SigmaViewportLike } from "./graphViewport.types";

export const GRAPH_VIEWER_FIT_PADDING_RATIO = 1.15;
export const GRAPH_VIEWER_INITIAL_FIT_DELAY_MS = 50;
export const GRAPH_VIEWER_INITIAL_FIT_DURATION_MS = 300;
export const GRAPH_VIEWER_CLUSTER_FIT_PADDING_RATIO = 1.35;
export const GRAPH_VIEWER_CLUSTER_FIT_DURATION_MS = 350;

export function fitSigmaToViewportResponse(
  sigma: SigmaViewportLike,
  response: GraphViewportResponse,
): ReturnType<typeof window.setTimeout> | null {
  if (response.nodes.length === 0) {
    return null;
  }
  sigma.refresh?.();
  const dimensions = sigmaDimensions(sigma);
  const xs = response.nodes.map((node) => node.x);
  const ys = response.nodes.map((node) => node.y);
  const width = Math.max(Math.max(...xs) - Math.min(...xs), 1);
  const height = Math.max(Math.max(...ys) - Math.min(...ys), 1);
  const ratio =
    Math.max(width / Math.max(dimensions.width, 1), height / Math.max(dimensions.height, 1)) *
    GRAPH_VIEWER_FIT_PADDING_RATIO;

  const camera = sigma.getCamera();

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
            x: state.x ?? (Math.min(...xs) + Math.max(...xs)) / 2,
            y: state.y ?? (Math.min(...ys) + Math.max(...ys)) / 2,
            ratio: Math.max(state.ratio * GRAPH_VIEWER_FIT_PADDING_RATIO, Number.EPSILON),
          },
          { duration: 100 },
        );
      }, GRAPH_VIEWER_INITIAL_FIT_DURATION_MS);
      return;
    }
    camera.animate?.(
      {
        x: (Math.min(...xs) + Math.max(...xs)) / 2,
        y: (Math.min(...ys) + Math.max(...ys)) / 2,
        ratio: Math.max(ratio, Number.EPSILON),
      },
      { duration: GRAPH_VIEWER_INITIAL_FIT_DURATION_MS },
    );
  }, GRAPH_VIEWER_INITIAL_FIT_DELAY_MS);
}

export function fitSigmaToClusterResponse(sigma: SigmaViewportLike, response: GraphViewportResponse): void {
  if (response.nodes.length === 0) {
    return;
  }
  const dimensions = sigmaDimensions(sigma);
  const bounds = responseBounds(response);
  const width = Math.max(bounds.xmax - bounds.xmin, 1);
  const height = Math.max(bounds.ymax - bounds.ymin, 1);
  const ratio =
    Math.max(width / Math.max(dimensions.width, 1), height / Math.max(dimensions.height, 1)) *
    GRAPH_VIEWER_CLUSTER_FIT_PADDING_RATIO;
  sigma.getCamera().animate?.(
    {
      x: (bounds.xmin + bounds.xmax) / 2,
      y: (bounds.ymin + bounds.ymax) / 2,
      ratio: Math.max(ratio, Number.EPSILON),
    },
    { duration: GRAPH_VIEWER_CLUSTER_FIT_DURATION_MS },
  );
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
