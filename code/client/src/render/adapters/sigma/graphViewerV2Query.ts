import type { GraphV2ViewportQuery } from "../../../api/graphV2Client";
import type {
  SigmaCameraLike,
  SigmaViewportBounds,
  SigmaViewportLike,
} from "./graphViewerV2Types";

// Settle delay before a server viewport query fires after panning within the
// same LOD level. LOD-level changes bypass this (they refresh immediately), so
// this only governs same-level pan responsiveness against extra server queries.
export const DEFAULT_GRAPH_VIEWER_V2_DEBOUNCE_MS = 120;
export const DEFAULT_GRAPH_VIEWER_V2_MAX_NODES = 2_500;
export const GRAPH_VIEWER_V2_VIEWPORT_PADDING_RATIO = 0.5;
export const GRAPH_VIEWER_V2_DETAIL_RATIO_THRESHOLD = 0.8;

export function buildGraphV2ViewportQuery({
  datasetId,
  layoutVersion,
  sigma,
  maxNodes,
  forceGlobal = false,
}: {
  datasetId: string;
  layoutVersion?: string | null;
  sigma: SigmaViewportLike;
  maxNodes: number;
  forceGlobal?: boolean;
}): GraphV2ViewportQuery {
  const ratio = sigmaCameraRatio(sigma.getCamera());
  const viewportBounds = sigmaViewportBounds(sigma);
  const lodLevel = forceGlobal ? 0 : semanticLodLevelForCameraRatio(ratio);
  const bounds =
    lodLevel === 0
      ? null
      : expandViewportBounds(
          viewportBounds,
          GRAPH_VIEWER_V2_VIEWPORT_PADDING_RATIO,
        );

  const query: GraphV2ViewportQuery = {
    dataset_id: datasetId,
    layout_version: layoutVersion ?? null,
    zoom: sigmaRatioToDisplayZoom(ratio),
    lod_level: lodLevel,
    max_nodes: maxNodes,
  };
  if (bounds) {
    query.xmin = bounds.xmin;
    query.xmax = bounds.xmax;
    query.ymin = bounds.ymin;
    query.ymax = bounds.ymax;
  }
  return query;
}

export function sigmaViewportBounds(
  sigma: SigmaViewportLike,
): SigmaViewportBounds {
  const dimensions = sigmaDimensions(sigma);
  const corners = [
    sigma.viewportToGraph({ x: 0, y: 0 }),
    sigma.viewportToGraph({ x: dimensions.width, y: 0 }),
    sigma.viewportToGraph({ x: 0, y: dimensions.height }),
    sigma.viewportToGraph({ x: dimensions.width, y: dimensions.height }),
  ];
  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);

  return {
    xmin: Math.min(...xs),
    xmax: Math.max(...xs),
    ymin: Math.min(...ys),
    ymax: Math.max(...ys),
  };
}

export function semanticLodLevelForCameraRatio(ratio: number): number {
  if (!Number.isFinite(ratio) || ratio <= 0) {
    return 1;
  }
  return ratio < GRAPH_VIEWER_V2_DETAIL_RATIO_THRESHOLD ? 1 : 0;
}

export function expandViewportBounds(
  bounds: SigmaViewportBounds,
  paddingRatio: number,
): SigmaViewportBounds {
  const width = bounds.xmax - bounds.xmin;
  const height = bounds.ymax - bounds.ymin;
  const xPadding = width * paddingRatio;
  const yPadding = height * paddingRatio;
  return {
    xmin: bounds.xmin - xPadding,
    xmax: bounds.xmax + xPadding,
    ymin: bounds.ymin - yPadding,
    ymax: bounds.ymax + yPadding,
  };
}

export function sigmaCameraRatio(camera: SigmaCameraLike): number {
  const state = camera.getState?.() ?? camera;
  return typeof state.ratio === "number" && Number.isFinite(state.ratio)
    ? state.ratio
    : 1;
}

export function sigmaDisplayZoom(camera: SigmaCameraLike): number {
  return sigmaRatioToDisplayZoom(sigmaCameraRatio(camera));
}

export function sigmaRatioToDisplayZoom(ratio: number): number {
  return 1 / Math.max(ratio, Number.EPSILON);
}

export function sigmaDimensions(sigma: SigmaViewportLike): {
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
