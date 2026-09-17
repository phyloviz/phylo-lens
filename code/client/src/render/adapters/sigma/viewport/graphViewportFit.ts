import type { PositionedGraph } from "../../../../contracts/positioned";
import type { SigmaViewportBounds, SigmaViewportLike } from "./graphViewport.types";

export const GRAPH_VIEWER_FIT_PADDING_RATIO = 1.15;
export const GRAPH_VIEWER_INITIAL_FIT_DELAY_MS = 50;
export const GRAPH_VIEWER_INITIAL_FIT_DURATION_MS = 300;
export const GRAPH_VIEWER_FOCUS_ZOOM_OUT_DURATION_MS = 140;
export const GRAPH_VIEWER_MIN_FOCUS_FIT_RATIO = 0.02;
export const GRAPH_VIEWER_CLUSTER_FIT_PADDING_RATIO = 1.35;
export const GRAPH_VIEWER_CLUSTER_FIT_DURATION_MS = 350;

export function fitSigmaToGraphSnapshot(
  sigma: SigmaViewportLike,
  graph: PositionedGraph,
  options: { resetFirst?: boolean } = {},
): (() => void) | null {
  if (graph.nodes.length === 0) return null;
  const camera = sigma.getCamera();
  let timer: ReturnType<typeof window.setTimeout> | null = null;
  let cancelled = false;
  let animating = false;
  let animationSequence = 0;
  const animate = (target: { x: number; y: number; ratio: number }, duration: number) => {
    const sequence = ++animationSequence;
    animating = true;
    void camera.animate(target, { duration }, () => {
      if (sequence === animationSequence) animating = false;
    });
  };
  const start = () => {
    if (cancelled) return;
    sigma.refresh?.();
    const target = cameraTargetForGraph(sigma, graph, GRAPH_VIEWER_FIT_PADDING_RATIO);
    const state = camera.getState();
    if (options.resetFirst === false && shouldStageFocusAnimation(state, target, state.ratio)) {
      animate(
        { x: state.x, y: state.y, ratio: stagedZoomOutRatio(state.ratio, target.ratio) },
        GRAPH_VIEWER_FOCUS_ZOOM_OUT_DURATION_MS,
      );
      timer = window.setTimeout(() => {
        if (!cancelled) animate(target, GRAPH_VIEWER_INITIAL_FIT_DURATION_MS - GRAPH_VIEWER_FOCUS_ZOOM_OUT_DURATION_MS);
      }, GRAPH_VIEWER_FOCUS_ZOOM_OUT_DURATION_MS);
    } else {
      animate(target, GRAPH_VIEWER_INITIAL_FIT_DURATION_MS);
    }
  };
  if (options.resetFirst === false) start();
  else timer = window.setTimeout(start, GRAPH_VIEWER_INITIAL_FIT_DELAY_MS);

  return () => {
    if (cancelled) return;
    cancelled = true;
    if (timer !== null) window.clearTimeout(timer);
    // Sigma replaces an existing animation when animate is called again.
    if (animating) void camera.animate(camera.getState(), { duration: 0 });
    animating = false;
  };
}

export function fitSigmaToClusterGraph(sigma: SigmaViewportLike, graph: PositionedGraph): void {
  if (graph.nodes.length === 0) {
    return;
  }
  sigma.refresh?.();
  sigma.getCamera().animate?.(cameraTargetForGraph(sigma, graph, GRAPH_VIEWER_CLUSTER_FIT_PADDING_RATIO), {
    duration: GRAPH_VIEWER_CLUSTER_FIT_DURATION_MS,
  });
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

function graphBounds(graph: PositionedGraph): SigmaViewportBounds {
  const xs = graph.nodes.map((node) => node.x);
  const ys = graph.nodes.map((node) => node.y);
  return {
    xmin: Math.min(...xs),
    xmax: Math.max(...xs),
    ymin: Math.min(...ys),
    ymax: Math.max(...ys),
  };
}

function cameraTargetForGraph(
  sigma: SigmaViewportLike,
  graph: PositionedGraph,
  paddingRatio: number,
): { x: number; y: number; ratio: number } {
  const bounds = graphBounds(graph);
  const center = graphPointToFramedGraph(sigma, {
    x: (bounds.xmin + bounds.xmax) / 2,
    y: (bounds.ymin + bounds.ymax) / 2,
  });
  const ratio = cameraRatioForGraph(sigma, graph, center, paddingRatio);
  return {
    x: center.x,
    y: center.y,
    ratio,
  };
}

function cameraRatioForGraph(
  sigma: SigmaViewportLike,
  graph: PositionedGraph,
  center: { x: number; y: number },
  paddingRatio: number,
): number {
  const dimensions = sigmaDimensions(sigma);
  const camera = sigma.getCamera();
  const cameraState = camera.getState?.() ?? camera;
  const currentRatio =
    typeof cameraState.ratio === "number" && Number.isFinite(cameraState.ratio) ? cameraState.ratio : 1;
  const viewportPoints = graph.nodes.map((node) =>
    sigma.graphToViewport(
      { x: node.x, y: node.y },
      {
        cameraState: {
          x: center.x,
          y: center.y,
          ratio: currentRatio,
          angle: typeof cameraState.angle === "number" && Number.isFinite(cameraState.angle) ? cameraState.angle : 0,
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

function sigmaDimensions(sigma: SigmaViewportLike): {
  width: number;
  height: number;
} {
  const dimensions = sigma.getDimensions?.();
  if (dimensions) {
    return dimensions;
  }
  const rect = sigma.getContainer?.().getBoundingClientRect();
  return {
    width: rect?.width ?? 1,
    height: rect?.height ?? 1,
  };
}

function graphPointToFramedGraph(sigma: SigmaViewportLike, point: { x: number; y: number }): { x: number; y: number } {
  return sigma.viewportToFramedGraph(sigma.graphToViewport(point));
}
