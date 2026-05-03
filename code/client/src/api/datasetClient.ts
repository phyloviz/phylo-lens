import {
  CanonicalDataset,
  NormalizeResponse,
  PrepareDatasetResponse,
  SOURCE_FORMAT_EDGELIST,
  SOURCE_FORMAT_NEWICK,
  SOURCE_FORMAT_TYPING_DATA,
  VisibleSliceQuery,
  VisibleSliceResponse,
} from "../contracts/canonical";
import { HttpClient } from "./httpClient";

export const ROUTE_NORMALIZE = "/dataset/normalize";
export const ROUTE_PREPARE = "/dataset/prepare";
export const ROUTE_VIEW_SLICE = "/dataset/view-slice";

export const ERR_INVALID_RESPONSE = "Invalid normalize response contract.";
export const ERR_INVALID_PREPARE_RESPONSE =
  "Invalid prepare dataset response contract.";
export const ERR_INVALID_VISIBLE_SLICE_RESPONSE =
  "Invalid visible slice response contract.";

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
const KEY_HIERARCHY_MS = "hierarchy_ms";
const KEY_STORE_MS = "store_ms";

export interface NormalizeRequest {
  format: typeof SOURCE_FORMAT_NEWICK | typeof SOURCE_FORMAT_EDGELIST;
  dataset_name: string;
  content: string;
  options?: {
    allow_self_loops?: boolean;
  };
  metadata_schema?: Array<{ key: string; type: string }>;
  metadata_by_node_id?: Record<
    string,
    Record<string, string | number | boolean | null>
  >;
}

export interface DatasetClientOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
}

export class DatasetClient {
  private readonly http: HttpClient;

  constructor(options: DatasetClientOptions) {
    this.http = new HttpClient({
      baseUrl: options.baseUrl,
      fetchImpl: options.fetchImpl,
    });
  }

  // Request canonical normalization and validate basic response shape.
  async normalizeDataset(
    request: NormalizeRequest,
  ): Promise<NormalizeResponse> {
    const response = await this.http.postJson<NormalizeRequest, unknown>(
      ROUTE_NORMALIZE,
      request,
    );

    if (!isNormalizeResponse(response)) {
      throw new Error(ERR_INVALID_RESPONSE);
    }

    return response;
  }

  // Prepare a dataset for LoD-backed visible-slice queries.
  async prepareDataset(
    request: NormalizeRequest,
  ): Promise<PrepareDatasetResponse> {
    const response = await this.http.postJson<NormalizeRequest, unknown>(
      ROUTE_PREPARE,
      request,
    );

    if (!isPrepareDatasetResponse(response)) {
      throw new Error(ERR_INVALID_PREPARE_RESPONSE);
    }

    return response;
  }

  // Request one bounded visible slice from a prepared dataset.
  async viewSlice(request: VisibleSliceQuery): Promise<VisibleSliceResponse> {
    const response = await this.http.postJson<VisibleSliceQuery, unknown>(
      ROUTE_VIEW_SLICE,
      request,
    );

    if (!isVisibleSliceResponse(response)) {
      throw new Error(ERR_INVALID_VISIBLE_SLICE_RESPONSE);
    }

    return response;
  }
}

// Validate the minimum runtime structure needed by the client.
export function isNormalizeResponse(
  value: unknown,
): value is NormalizeResponse {
  if (!isRecord(value)) {
    return false;
  }

  const dataset = value[KEY_DATASET];
  const stats = value[KEY_STATS];
  const warnings = value[KEY_WARNINGS];

  if (!isCanonicalDataset(dataset)) {
    return false;
  }

  if (!isRecord(stats)) {
    return false;
  }

  if (
    typeof stats[KEY_NODE_COUNT] !== "number" ||
    typeof stats[KEY_EDGE_COUNT] !== "number" ||
    typeof stats[KEY_INGEST_MS] !== "number" ||
    typeof stats[KEY_NORMALIZE_MS] !== "number"
  ) {
    return false;
  }

  if (
    !Array.isArray(warnings) ||
    warnings.some((item) => typeof item !== "string")
  ) {
    return false;
  }

  return true;
}

export function isPrepareDatasetResponse(
  value: unknown,
): value is PrepareDatasetResponse {
  if (!isRecord(value)) {
    return false;
  }

  const stats = value[KEY_STATS];
  const warnings = value[KEY_WARNINGS];

  if (typeof value[KEY_DATASET_ID] !== "string" || !isRecord(stats)) {
    return false;
  }

  if (
    typeof stats[KEY_NODE_COUNT] !== "number" ||
    typeof stats[KEY_EDGE_COUNT] !== "number" ||
    typeof stats[KEY_INGEST_MS] !== "number" ||
    typeof stats[KEY_NORMALIZE_MS] !== "number" ||
    typeof stats[KEY_HIERARCHY_MS] !== "number" ||
    typeof stats[KEY_STORE_MS] !== "number"
  ) {
    return false;
  }

  if (
    !Array.isArray(warnings) ||
    warnings.some((item) => typeof item !== "string")
  ) {
    return false;
  }

  return true;
}

export function isVisibleSliceResponse(
  value: unknown,
): value is VisibleSliceResponse {
  if (!isRecord(value)) {
    return false;
  }

  const nodes = value[KEY_NODES];
  const edges = value[KEY_EDGES];
  const collapsedClusters = value[KEY_COLLAPSED_CLUSTERS];
  const viewMeta = value[KEY_VIEW_META];

  if (
    typeof value[KEY_DATASET_ID] !== "string" ||
    typeof value[KEY_LOD_LEVEL] !== "number"
  ) {
    return false;
  }

  if (
    !Array.isArray(nodes) ||
    nodes.some((node) => {
      if (!isRecord(node) || typeof node[KEY_NODE_ID] !== "string") {
        return true;
      }

      const nodeX = node[KEY_NODE_X];
      const nodeY = node[KEY_NODE_Y];
      const clusterId = node[KEY_NODE_CLUSTER_ID];
      const isClusterProxy = node[KEY_NODE_IS_CLUSTER_PROXY];
      const subtreeSize = node[KEY_NODE_SUBTREE_SIZE];
      const leafCount = node[KEY_NODE_LEAF_COUNT];
      return (
        !isOptionalNumber(nodeX) ||
        !isOptionalNumber(nodeY) ||
        !isOptionalString(clusterId) ||
        !isOptionalBoolean(isClusterProxy) ||
        !isOptionalNumber(subtreeSize) ||
        !isOptionalNumber(leafCount)
      );
    })
  ) {
    return false;
  }

  if (
    !Array.isArray(edges) ||
    edges.some(
      (edge) =>
        !isRecord(edge) ||
        typeof edge[KEY_EDGE_ID] !== "string" ||
        typeof edge[KEY_EDGE_SOURCE] !== "string" ||
        typeof edge[KEY_EDGE_TARGET] !== "string" ||
        !isOptionalNumber(edge[KEY_EDGE_DISTANCE]),
    )
  ) {
    return false;
  }

  if (
    !Array.isArray(collapsedClusters) ||
    collapsedClusters.some(
      (cluster) =>
        !isRecord(cluster) ||
        typeof cluster.cluster_id !== "string" ||
        typeof cluster.subtree_size !== "number" ||
        !isOptionalString(cluster.representative_node_id) ||
        !isOptionalNumberRecord(cluster.centroid),
    )
  ) {
    return false;
  }

  if (!isRecord(viewMeta)) {
    return false;
  }

  const viewport = viewMeta[KEY_VIEWPORT];
  const globalBounds = viewMeta[KEY_GLOBAL_BOUNDS];
  if (
    typeof viewMeta[KEY_ZOOM] !== "number" ||
    typeof viewMeta[KEY_RETURNED_NODE_COUNT] !== "number" ||
    typeof viewMeta[KEY_RETURNED_EDGE_COUNT] !== "number" ||
    !isRecord(viewport) ||
    typeof viewport.x !== "number" ||
    typeof viewport.y !== "number" ||
    typeof viewport.width !== "number" ||
    typeof viewport.height !== "number" ||
    !isOptionalSpatialBounds(globalBounds)
  ) {
    return false;
  }

  return true;
}

// Validate canonical dataset structure shared by server and client contracts.
export function isCanonicalDataset(value: unknown): value is CanonicalDataset {
  if (!isRecord(value)) {
    return false;
  }

  if (typeof value[KEY_DATASET_ID] !== "string") {
    return false;
  }

  const nodes = value[KEY_NODES];
  const edges = value[KEY_EDGES];
  const source = value[KEY_SOURCE];

  if (
    !Array.isArray(nodes) ||
    nodes.some((node) => {
      if (!isRecord(node) || typeof node[KEY_NODE_ID] !== "string") {
        return true;
      }

      const nodeX = node[KEY_NODE_X];
      const nodeY = node[KEY_NODE_Y];
      const clusterId = node[KEY_NODE_CLUSTER_ID];
      const isClusterProxy = node[KEY_NODE_IS_CLUSTER_PROXY];
      const subtreeSize = node[KEY_NODE_SUBTREE_SIZE];
      const leafCount = node[KEY_NODE_LEAF_COUNT];
      return (
        !isOptionalNumber(nodeX) ||
        !isOptionalNumber(nodeY) ||
        !isOptionalString(clusterId) ||
        !isOptionalBoolean(isClusterProxy) ||
        !isOptionalNumber(subtreeSize) ||
        !isOptionalNumber(leafCount)
      );
    })
  ) {
    return false;
  }

  if (
    !Array.isArray(edges) ||
    edges.some(
      (edge) =>
        !isRecord(edge) ||
        typeof edge[KEY_EDGE_ID] !== "string" ||
        typeof edge[KEY_EDGE_SOURCE] !== "string" ||
        typeof edge[KEY_EDGE_TARGET] !== "string" ||
        !isOptionalNumber(edge[KEY_EDGE_DISTANCE]),
    )
  ) {
    return false;
  }

  if (!isRecord(source)) {
    return false;
  }

  const format = source[KEY_SOURCE_FORMAT];
  const isKnownFormat =
    format === SOURCE_FORMAT_NEWICK ||
    format === SOURCE_FORMAT_EDGELIST ||
    format === SOURCE_FORMAT_TYPING_DATA;

  if (!isKnownFormat || typeof source[KEY_SOURCE_GENERATED_AT] !== "string") {
    return false;
  }

  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  // Confirm value is a non-null object before key-based checks.
  return typeof value === "object" && value !== null;
}

function isOptionalNumber(value: unknown): boolean {
  return value === undefined || value === null || typeof value === "number";
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || value === null || typeof value === "string";
}

function isOptionalBoolean(value: unknown): boolean {
  return value === undefined || value === null || typeof value === "boolean";
}

function isOptionalNumberRecord(value: unknown): boolean {
  if (value === undefined || value === null) {
    return true;
  }

  if (!isRecord(value)) {
    return false;
  }

  return Object.values(value).every((entry) => typeof entry === "number");
}

function isOptionalSpatialBounds(value: unknown): boolean {
  if (value === undefined || value === null) {
    return true;
  }

  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.min_x === "number" &&
    typeof value.max_x === "number" &&
    typeof value.min_y === "number" &&
    typeof value.max_y === "number"
  );
}
