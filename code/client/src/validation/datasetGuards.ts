import {
  SOURCE_FORMAT_EDGELIST,
  SOURCE_FORMAT_NEWICK,
  SOURCE_FORMAT_TYPING_DATA,
} from "../contracts/models";
import type {
  CanonicalDataset,
  NormalizeResponse,
  PrepareDatasetResponse,
  VisibleSliceResponse,
} from "../contracts/models";
import {
  hasFiniteNumberFields,
  isArrayOf,
  isFiniteNumber,
  isOptionalBoolean,
  isOptionalFiniteNumber,
  isOptionalNumberRecord,
  isOptionalString,
  isRecord,
  isString,
  isStringArray,
} from "./guards";

const KEY_DATASET = "dataset";
const KEY_STATS = "stats";
const KEY_WARNINGS = "warnings";

const KEY_DATASET_ID = "dataset_id";
const KEY_NODES = "nodes";
const KEY_EDGES = "edges";
const KEY_SOURCE = "source";

const KEY_NODE_ID = "id";
const KEY_NODE_X = "x";
const KEY_NODE_Y = "y";
const KEY_NODE_CLUSTER_ID = "cluster_id";
const KEY_NODE_IS_CLUSTER_PROXY = "is_cluster_proxy";
const KEY_NODE_SUBTREE_SIZE = "subtree_size";
const KEY_NODE_LEAF_COUNT = "leaf_count";

const KEY_EDGE_ID = "id";
const KEY_EDGE_SOURCE = "source";
const KEY_EDGE_TARGET = "target";
const KEY_EDGE_DISTANCE = "distance";

const KEY_NODE_COUNT = "node_count";
const KEY_EDGE_COUNT = "edge_count";
const KEY_INGEST_MS = "ingest_ms";
const KEY_NORMALIZE_MS = "normalize_ms";
const KEY_HIERARCHY_MS = "hierarchy_ms";
const KEY_STORE_MS = "store_ms";

const KEY_SOURCE_FORMAT = "format";
const KEY_SOURCE_GENERATED_AT = "generated_at";

const KEY_LOD_LEVEL = "lod_level";
const KEY_COLLAPSED_CLUSTERS = "collapsed_clusters";
const KEY_VIEW_META = "view_meta";
const KEY_VIEWPORT = "viewport";
const KEY_GLOBAL_BOUNDS = "global_bounds";
const KEY_ZOOM = "zoom";
const KEY_RETURNED_NODE_COUNT = "returned_node_count";
const KEY_RETURNED_EDGE_COUNT = "returned_edge_count";

const KEY_FOCUS_CLUSTER_ID = "focus_cluster_id";
const KEY_FOCUS_CLUSTER_BOUNDS = "focus_cluster_bounds";

const NORMALIZE_STATS_KEYS = [
  KEY_NODE_COUNT,
  KEY_EDGE_COUNT,
  KEY_INGEST_MS,
  KEY_NORMALIZE_MS,
] as const;

const PREPARE_STATS_KEYS = [
  KEY_NODE_COUNT,
  KEY_EDGE_COUNT,
  KEY_INGEST_MS,
  KEY_NORMALIZE_MS,
  KEY_HIERARCHY_MS,
  KEY_STORE_MS,
] as const;

export function isNormalizeResponse(
  value: unknown,
): value is NormalizeResponse {
  return (
    isRecord(value) &&
    isCanonicalDataset(value[KEY_DATASET]) &&
    hasFiniteNumberFields(value[KEY_STATS], NORMALIZE_STATS_KEYS) &&
    isStringArray(value[KEY_WARNINGS])
  );
}

export function isPrepareDatasetResponse(
  value: unknown,
): value is PrepareDatasetResponse {
  return (
    isRecord(value) &&
    isString(value[KEY_DATASET_ID]) &&
    hasFiniteNumberFields(value[KEY_STATS], PREPARE_STATS_KEYS) &&
    isStringArray(value[KEY_WARNINGS])
  );
}

export function isVisibleSliceResponse(
  value: unknown,
): value is VisibleSliceResponse {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isString(value[KEY_DATASET_ID]) &&
    isFiniteNumber(value[KEY_LOD_LEVEL]) &&
    isArrayOf(value[KEY_NODES], isClientNode) &&
    isArrayOf(value[KEY_EDGES], isClientEdge) &&
    isArrayOf(value[KEY_COLLAPSED_CLUSTERS], isCollapsedCluster) &&
    isViewMeta(value[KEY_VIEW_META])
  );
}

export function isCanonicalDataset(value: unknown): value is CanonicalDataset {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isString(value[KEY_DATASET_ID]) &&
    isArrayOf(value[KEY_NODES], isClientNode) &&
    isArrayOf(value[KEY_EDGES], isClientEdge) &&
    isSource(value[KEY_SOURCE])
  );
}

function isClientNode(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isString(value[KEY_NODE_ID]) &&
    isOptionalFiniteNumber(value[KEY_NODE_X]) &&
    isOptionalFiniteNumber(value[KEY_NODE_Y]) &&
    isOptionalString(value[KEY_NODE_CLUSTER_ID]) &&
    isOptionalBoolean(value[KEY_NODE_IS_CLUSTER_PROXY]) &&
    isOptionalFiniteNumber(value[KEY_NODE_SUBTREE_SIZE]) &&
    isOptionalFiniteNumber(value[KEY_NODE_LEAF_COUNT])
  );
}

function isClientEdge(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isString(value[KEY_EDGE_ID]) &&
    isString(value[KEY_EDGE_SOURCE]) &&
    isString(value[KEY_EDGE_TARGET]) &&
    isOptionalFiniteNumber(value[KEY_EDGE_DISTANCE])
  );
}

function isCollapsedCluster(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isString(value.cluster_id) &&
    isFiniteNumber(value.subtree_size) &&
    isOptionalString(value.representative_node_id) &&
    isOptionalNumberRecord(value.centroid)
  );
}

function isViewMeta(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isFiniteNumber(value[KEY_ZOOM]) &&
    isFiniteNumber(value[KEY_RETURNED_NODE_COUNT]) &&
    isFiniteNumber(value[KEY_RETURNED_EDGE_COUNT]) &&
    isViewport(value[KEY_VIEWPORT]) &&
    isOptionalSpatialBounds(value[KEY_GLOBAL_BOUNDS]) &&
    isOptionalString(value[KEY_FOCUS_CLUSTER_ID]) &&
    isOptionalSpatialBounds(value[KEY_FOCUS_CLUSTER_BOUNDS])
  );
}

function isViewport(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isFiniteNumber(value.x) &&
    isFiniteNumber(value.y) &&
    isFiniteNumber(value.width) &&
    isFiniteNumber(value.height)
  );
}

function isOptionalSpatialBounds(
  value: unknown,
): value is Record<string, number> | null | undefined {
  if (value === undefined || value === null) {
    return true;
  }

  if (!isRecord(value)) {
    return false;
  }

  return (
    isFiniteNumber(value.min_x) &&
    isFiniteNumber(value.max_x) &&
    isFiniteNumber(value.min_y) &&
    isFiniteNumber(value.max_y)
  );
}

function isSource(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) {
    return false;
  }

  const format = value[KEY_SOURCE_FORMAT];

  return (
    isKnownSourceFormat(format) && isString(value[KEY_SOURCE_GENERATED_AT])
  );
}

function isKnownSourceFormat(value: unknown): boolean {
  return (
    value === SOURCE_FORMAT_NEWICK ||
    value === SOURCE_FORMAT_EDGELIST ||
    value === SOURCE_FORMAT_TYPING_DATA
  );
}
