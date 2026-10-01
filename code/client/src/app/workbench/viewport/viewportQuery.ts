import type { GraphViewportQuery } from "../../../api/graphContracts";
import type { RenderViewportBounds, RenderViewportSyncState } from "../../../render/renderer.types";

export const DEFAULT_GRAPH_VIEWER_DEBOUNCE_MS = 120;
export const GRAPH_VIEWER_LOD_CHANGE_DEBOUNCE_MS = 60;
export const DEFAULT_LOD_REPRESENTATION_SPACING_PX = 24;
export const GRAPH_VIEWER_SMALL_TREE_NODE_THRESHOLD = 2_500;
export const GRAPH_VIEWER_VIEWPORT_PADDING_RATIO = 0.5;
export const GRAPH_VIEWER_DETAIL_RATIO_THRESHOLD = 0.8;
export const GRAPH_VIEWER_LOD_RATIO_STEP = 0.4;
export const GRAPH_VIEWER_DENSE_LOD_RATIO_STEP = 2 / 3;
export const GRAPH_VIEWER_DENSE_LOD_MIN_TIER_COUNT = 8;
export const GRAPH_VIEWER_LOD_RATIO_HYSTERESIS = 0.05;

export function buildGraphViewportQuery({
  datasetId,
  layoutVersion,
  viewState,
  maxNodes,
  forceGlobal = false,
  forceFinestTier = false,
  forcedLodLevel,
  semanticLodLevel,
  lodTierCount = 1,
  currentLodLevel = null,
  previousEffectiveLodLevel,
  representationSpacingPx = DEFAULT_LOD_REPRESENTATION_SPACING_PX,
}: {
  datasetId: string;
  layoutVersion?: string | null;
  viewState: RenderViewportSyncState | null;
  maxNodes?: number;
  forceGlobal?: boolean;
  forceFinestTier?: boolean;
  forcedLodLevel?: number;
  semanticLodLevel?: number;
  lodTierCount?: number;
  currentLodLevel?: number | null;
  previousEffectiveLodLevel?: number | null;
  representationSpacingPx?: number;
}): GraphViewportQuery {
  const ratio = viewState?.cameraRatio ?? 1;
  const lodLevel = forceFinestTier
    ? Math.max(lodTierCount - 1, 0)
    : typeof forcedLodLevel === "number" && Number.isFinite(forcedLodLevel)
      ? Math.min(Math.max(Math.round(forcedLodLevel), 0), Math.max(lodTierCount - 1, 0))
      : forceGlobal
        ? 0
        : typeof semanticLodLevel === "number" && Number.isFinite(semanticLodLevel)
          ? Math.min(Math.max(Math.round(semanticLodLevel), 0), Math.max(lodTierCount - 1, 0))
          : semanticLodLevelForCameraRatioWithHysteresis(ratio, lodTierCount, currentLodLevel);
  const adaptive = !forceGlobal && !forceFinestTier && forcedLodLevel === undefined && hasViewportPixelSize(viewState);
  const bounds =
    viewState && !forceGlobal && !forceFinestTier && (lodLevel !== 0 || adaptive || forcedLodLevel !== undefined)
      ? expandViewportBounds(viewState.bounds, GRAPH_VIEWER_VIEWPORT_PADDING_RATIO)
      : null;

  const query: GraphViewportQuery = {
    dataset_id: datasetId,
    layout_version: layoutVersion ?? null,
    zoom: displayZoomForCameraRatio(ratio),
    lod_level: lodLevel,
    ...(maxNodes === undefined ? {} : { max_nodes: maxNodes }),
  };
  if (adaptive && viewState?.pixelSize) {
    if (!Number.isFinite(representationSpacingPx) || representationSpacingPx <= 0)
      throw new Error("LoD representation spacing must be finite and positive.");
    const target = Math.max(
      1,
      Math.floor((viewState.pixelSize.width * viewState.pixelSize.height) / representationSpacingPx ** 2),
    );
    if (!Number.isSafeInteger(target)) throw new Error("LoD representation target must be a finite safe integer.");
    query.lod_target_representations = target;
    query.lod_selection_bounds = viewState.bounds;
    if (previousEffectiveLodLevel !== undefined && previousEffectiveLodLevel !== null)
      query.previous_lod_level = previousEffectiveLodLevel;
  }
  if (bounds) {
    query.xmin = bounds.xmin;
    query.xmax = bounds.xmax;
    query.ymin = bounds.ymin;
    query.ymax = bounds.ymax;
  }
  return query;
}

export function hasViewportPixelSize(state: RenderViewportSyncState | null): boolean {
  return Boolean(
    state?.pixelSize &&
    Number.isFinite(state.pixelSize.width) &&
    state.pixelSize.width > 0 &&
    Number.isFinite(state.pixelSize.height) &&
    state.pixelSize.height > 0,
  );
}

export function semanticLodLevelForCameraRatio(ratio: number, lodTierCount = 1): number {
  if (!Number.isFinite(ratio) || ratio <= 0 || lodTierCount <= 1) {
    return 0;
  }
  if (ratio >= GRAPH_VIEWER_DETAIL_RATIO_THRESHOLD) {
    return 0;
  }
  const ratioStep = lodRatioStepForTierCount(lodTierCount);
  let tier = 1;
  let boundary = GRAPH_VIEWER_DETAIL_RATIO_THRESHOLD * ratioStep;
  while (tier < lodTierCount - 1 && ratio < boundary) {
    tier += 1;
    boundary *= ratioStep;
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
  // The transition out of the current tier has a different threshold in each
  // direction. Scale its dead band proportionally so deep zoom stays reachable.
  const boundaryTier = naiveTier > currentLodLevel ? currentLodLevel : currentLodLevel - 1;
  const boundary = GRAPH_VIEWER_DETAIL_RATIO_THRESHOLD * Math.pow(lodRatioStepForTierCount(lodTierCount), boundaryTier);
  const remainsInCurrentTier =
    naiveTier > currentLodLevel
      ? ratio >= boundary * (1 - GRAPH_VIEWER_LOD_RATIO_HYSTERESIS)
      : ratio <= boundary * (1 + GRAPH_VIEWER_LOD_RATIO_HYSTERESIS);
  return remainsInCurrentTier ? currentLodLevel : naiveTier;
}

function lodRatioStepForTierCount(lodTierCount: number): number {
  return lodTierCount >= GRAPH_VIEWER_DENSE_LOD_MIN_TIER_COUNT
    ? GRAPH_VIEWER_DENSE_LOD_RATIO_STEP
    : GRAPH_VIEWER_LOD_RATIO_STEP;
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
