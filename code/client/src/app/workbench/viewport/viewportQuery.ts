import type { GraphViewportQuery } from "../../../api/graphContracts";
import type { RenderViewportBounds, RenderViewportSyncState } from "../../../render/renderer.types";

export const DEFAULT_GRAPH_VIEWER_DEBOUNCE_MS = 120;
export const GRAPH_VIEWER_LOD_CHANGE_DEBOUNCE_MS = 60;
export const DEFAULT_GRAPH_VIEWER_MAX_NODES = 5_000;
export const GRAPH_VIEWER_SMALL_TREE_NODE_THRESHOLD = 2_500;
export const GRAPH_VIEWER_VIEWPORT_PADDING_RATIO = 0.5;
export const GRAPH_VIEWER_DETAIL_RATIO_THRESHOLD = 0.8;
export const GRAPH_VIEWER_LOD_RATIO_STEP = 0.4;
export const GRAPH_VIEWER_LOD_RATIO_HYSTERESIS = 0.05;

export function buildGraphViewportQuery({
  datasetId,
  layoutVersion,
  viewState,
  maxNodes,
  forceGlobal = false,
  forceFinestTier = false,
  forcedLodLevel,
  lodTierCount = 1,
  currentLodLevel = null,
}: {
  datasetId: string;
  layoutVersion?: string | null;
  viewState: RenderViewportSyncState | null;
  maxNodes: number;
  forceGlobal?: boolean;
  forceFinestTier?: boolean;
  forcedLodLevel?: number;
  lodTierCount?: number;
  currentLodLevel?: number | null;
}): GraphViewportQuery {
  const ratio = viewState?.cameraRatio ?? 1;
  const lodLevel = forceFinestTier
    ? Math.max(lodTierCount - 1, 0)
    : typeof forcedLodLevel === "number" && Number.isFinite(forcedLodLevel)
      ? Math.min(Math.max(Math.round(forcedLodLevel), 0), Math.max(lodTierCount - 1, 0))
      : forceGlobal
        ? 0
        : semanticLodLevelForCameraRatioWithHysteresis(ratio, lodTierCount, currentLodLevel);
  const bounds =
    viewState && !forceFinestTier && lodLevel !== 0
      ? expandViewportBounds(viewState.bounds, GRAPH_VIEWER_VIEWPORT_PADDING_RATIO)
      : null;

  const query: GraphViewportQuery = {
    dataset_id: datasetId,
    layout_version: layoutVersion ?? null,
    zoom: displayZoomForCameraRatio(ratio),
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

export function semanticLodLevelForCameraRatio(ratio: number, lodTierCount = 1): number {
  if (!Number.isFinite(ratio) || ratio <= 0 || lodTierCount <= 1) {
    return 0;
  }
  if (ratio >= GRAPH_VIEWER_DETAIL_RATIO_THRESHOLD) {
    return 0;
  }
  let tier = 1;
  let boundary = GRAPH_VIEWER_DETAIL_RATIO_THRESHOLD * GRAPH_VIEWER_LOD_RATIO_STEP;
  while (tier < lodTierCount - 1 && ratio < boundary) {
    tier += 1;
    boundary *= GRAPH_VIEWER_LOD_RATIO_STEP;
  }
  return tier;
}

export function semanticLodLevelForCameraRatioWithHysteresis(
  ratio: number,
  lodTierCount = 1,
  currentLodLevel: number | null = null,
): number {
  const naiveTier = semanticLodLevelForCameraRatio(ratio, lodTierCount);
  if (currentLodLevel === null || !Number.isFinite(ratio) || ratio <= 0 || naiveTier === currentLodLevel) {
    return naiveTier;
  }
  const boundaryTier = Math.min(currentLodLevel, naiveTier);
  const boundary = GRAPH_VIEWER_DETAIL_RATIO_THRESHOLD * Math.pow(GRAPH_VIEWER_LOD_RATIO_STEP, boundaryTier);
  const inDeadBand =
    ratio > boundary - GRAPH_VIEWER_LOD_RATIO_HYSTERESIS && ratio < boundary + GRAPH_VIEWER_LOD_RATIO_HYSTERESIS;
  return inDeadBand ? currentLodLevel : naiveTier;
}

export function expandViewportBounds(bounds: RenderViewportBounds, paddingRatio: number): RenderViewportBounds {
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

export function displayZoomForCameraRatio(ratio: number): number {
  return 1 / Math.max(ratio, Number.EPSILON);
}
