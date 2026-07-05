import type { GraphV2ViewportQuery } from "../../../api/graphV2Client";
import type {
  SigmaCameraLike,
  SigmaViewportBounds,
  SigmaViewportLike,
} from "./graphViewerV2Types";

// Settle delay before a server viewport query fires after panning within the
// same LOD level. This governs same-level pan responsiveness against extra
// server queries.
export const DEFAULT_GRAPH_VIEWER_V2_DEBOUNCE_MS = 120;
// Settle delay for LOD-level changes (zoom crossing the detail threshold).
// LOD changes used to refresh immediately (0ms), which let rapid zoom thrash
// the server with a full round-trip + graph rebuild per intermediate frame.
// A short debounce keeps the transition responsive while collapsing bursts of
// threshold crossings into a single query.
export const GRAPH_VIEWER_V2_LOD_CHANGE_DEBOUNCE_MS = 60;
export const DEFAULT_GRAPH_VIEWER_V2_MAX_NODES = 5_000;
// Trees at or below this node count are rendered whole once at LOD 0 and never
// re-queried on camera movement: semantic zooming is bypassed entirely to save
// server round-trips because the full tree already fits in the client. Kept
// below the per-viewport cap so mid-size trees still get bounded pan-refetch
// while exploring rather than freezing on the initial overview.
export const GRAPH_VIEWER_V2_SMALL_TREE_NODE_THRESHOLD = 2_500;
export const GRAPH_VIEWER_V2_VIEWPORT_PADDING_RATIO = 0.5;
// Camera ratio at or above which the coarsest overview (tier 0) is shown. This
// is also the first zoom-in boundary: crossing below it reveals the next tier.
export const GRAPH_VIEWER_V2_DETAIL_RATIO_THRESHOLD = 0.8;
// Each finer tier boundary is this fraction of the previous one, so every tier
// requires ~2.5x more zoom-in than the last. Boundary B_k = 0.8 * 0.4^(k-1).
export const GRAPH_VIEWER_V2_LOD_RATIO_STEP = 0.4;
// Symmetric dead-band (in ratio space) around each tier boundary. While the
// camera ratio sits inside the band the current tier is held, so small zoom
// wobble near a boundary does not thrash back and forth between tiers.
export const GRAPH_VIEWER_V2_LOD_RATIO_HYSTERESIS = 0.05;

export function buildGraphV2ViewportQuery({
  datasetId,
  layoutVersion,
  sigma,
  maxNodes,
  forceGlobal = false,
  forceFinestTier = false,
  lodTierCount = 1,
  currentLodLevel = null,
}: {
  datasetId: string;
  layoutVersion?: string | null;
  sigma: SigmaViewportLike;
  maxNodes: number;
  forceGlobal?: boolean;
  // Request the finest precomputed tier (all individual nodes, no cluster
  // representatives) with no bounds. Used for the initial load of a small tree
  // that fits whole in the client, so it opens as ordinary nodes rather than
  // the triangle overview. Takes precedence over forceGlobal.
  forceFinestTier?: boolean;
  // Number of precomputed LoD tiers reported by the prepare response. With a
  // value of 1 the mapping always resolves to tier 0 (current behavior).
  lodTierCount?: number;
  // The tier last requested, used as the hysteresis anchor. null on the first
  // query (no prior tier to hold).
  currentLodLevel?: number | null;
}): GraphV2ViewportQuery {
  const ratio = sigmaCameraRatio(sigma.getCamera());
  const viewportBounds = sigmaViewportBounds(sigma);
  const lodLevel = forceFinestTier
    ? Math.max(lodTierCount - 1, 0)
    : forceGlobal
      ? 0
      : semanticLodLevelForCameraRatioWithHysteresis(
          ratio,
          lodTierCount,
          currentLodLevel,
        );
  // A finest-tier small-tree load reads the whole tree unbounded (it fits in
  // the client), and tier 0 is always the fixed global overview; both carry no
  // bounds. Finer tiers are viewport-bounded so panning reveals new regions.
  const bounds =
    forceFinestTier || lodLevel === 0
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

// Map a camera ratio to a discrete LoD tier index in [0, lodTierCount - 1].
// Tier 0 is the overview (ratio >= 0.8); each finer tier's boundary is the
// previous one scaled by GRAPH_VIEWER_V2_LOD_RATIO_STEP, so zooming in walks
// down the tiers geometrically. Clamps to the finest available tier.
export function semanticLodLevelForCameraRatio(
  ratio: number,
  lodTierCount = 1,
): number {
  if (!Number.isFinite(ratio) || ratio <= 0 || lodTierCount <= 1) {
    return 0;
  }
  if (ratio >= GRAPH_VIEWER_V2_DETAIL_RATIO_THRESHOLD) {
    return 0;
  }
  let tier = 1;
  let boundary =
    GRAPH_VIEWER_V2_DETAIL_RATIO_THRESHOLD * GRAPH_VIEWER_V2_LOD_RATIO_STEP;
  while (tier < lodTierCount - 1 && ratio < boundary) {
    tier += 1;
    boundary *= GRAPH_VIEWER_V2_LOD_RATIO_STEP;
  }
  return tier;
}

// Wrap the band mapping with a dead-band so a ratio hovering near a tier
// boundary keeps the current tier instead of oscillating. currentLodLevel is
// the tier last requested; null means there is no prior tier to hold.
export function semanticLodLevelForCameraRatioWithHysteresis(
  ratio: number,
  lodTierCount = 1,
  currentLodLevel: number | null = null,
): number {
  const naiveTier = semanticLodLevelForCameraRatio(ratio, lodTierCount);
  if (
    currentLodLevel === null ||
    !Number.isFinite(ratio) ||
    ratio <= 0 ||
    naiveTier === currentLodLevel
  ) {
    return naiveTier;
  }
  // Boundary that separates the current tier from the naive one: the lower of
  // the two tier indices identifies which geometric boundary is being crossed.
  const boundaryTier = Math.min(currentLodLevel, naiveTier);
  const boundary =
    GRAPH_VIEWER_V2_DETAIL_RATIO_THRESHOLD *
    Math.pow(GRAPH_VIEWER_V2_LOD_RATIO_STEP, boundaryTier);
  const inDeadBand =
    ratio > boundary - GRAPH_VIEWER_V2_LOD_RATIO_HYSTERESIS &&
    ratio < boundary + GRAPH_VIEWER_V2_LOD_RATIO_HYSTERESIS;
  return inDeadBand ? currentLodLevel : naiveTier;
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
