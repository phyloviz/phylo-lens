import type { MetadataField } from "../../../contracts/models";
import type { VisualMappingOptions } from "../../../render/mapping/visualMapping";

export const ERR_INVALID_ANCILLARY_JSON =
  "Ancillary JSON must be a valid object with metadata_schema and/or metadata_by_node_id.";

const KEY_METADATA_SCHEMA = "metadata_schema";
const KEY_METADATA_BY_NODE_ID = "metadata_by_node_id";
const KEY_VISUAL_MAPPING = "visual_mapping";

export interface AncillaryPayload {
  metadata_schema?: MetadataField[];
  metadata_by_node_id?: Record<string, Record<string, string | number | boolean | null>>;
  visual_mapping?: VisualMappingOptions;
}

export function parseAncillaryPayload(rawInput: string): AncillaryPayload {
  if (!rawInput) {
    return {};
  }

  const parsed: unknown = JSON.parse(rawInput);
  if (!parsed || typeof parsed !== "object") {
    throw new Error(ERR_INVALID_ANCILLARY_JSON);
  }

  const record = parsed as Record<string, unknown>;
  const metadataSchema = record[KEY_METADATA_SCHEMA];
  const metadataByNodeId = record[KEY_METADATA_BY_NODE_ID];
  const visualMapping = record[KEY_VISUAL_MAPPING];

  const hasSchema = Array.isArray(metadataSchema);
  const hasByNodeId =
    metadataByNodeId !== undefined && metadataByNodeId !== null && typeof metadataByNodeId === "object";

  if (!hasSchema && !hasByNodeId) {
    throw new Error(ERR_INVALID_ANCILLARY_JSON);
  }

  return {
    metadata_schema: hasSchema ? (metadataSchema as MetadataField[]) : undefined,
    metadata_by_node_id: hasByNodeId
      ? (metadataByNodeId as Record<string, Record<string, string | number | boolean | null>>)
      : undefined,
    visual_mapping:
      visualMapping && typeof visualMapping === "object" ? (visualMapping as VisualMappingOptions) : undefined,
  };
}
