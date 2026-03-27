import {
  CanonicalDataset,
  NormalizeResponse,
  SOURCE_FORMAT_EDGELIST,
  SOURCE_FORMAT_NEWICK,
  SOURCE_FORMAT_TYPING_DATA,
} from "../contracts/canonical";
import { HttpClient } from "./httpClient";

export const ROUTE_NORMALIZE = "/dataset/normalize";

export const ERR_INVALID_RESPONSE = "Invalid normalize response contract.";

const KEY_DATASET = "dataset";
const KEY_STATS = "stats";
const KEY_WARNINGS = "warnings";

const KEY_DATASET_ID = "dataset_id";
const KEY_NODES = "nodes";
const KEY_EDGES = "edges";
const KEY_SOURCE = "source";

const KEY_NODE_ID = "id";
const KEY_EDGE_ID = "id";
const KEY_EDGE_SOURCE = "source";
const KEY_EDGE_TARGET = "target";

const KEY_NODE_COUNT = "node_count";
const KEY_EDGE_COUNT = "edge_count";
const KEY_INGEST_MS = "ingest_ms";
const KEY_NORMALIZE_MS = "normalize_ms";

const KEY_SOURCE_FORMAT = "format";
const KEY_SOURCE_GENERATED_AT = "generated_at";

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
    nodes.some(
      (node) => !isRecord(node) || typeof node[KEY_NODE_ID] !== "string",
    )
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
        typeof edge[KEY_EDGE_TARGET] !== "string",
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
