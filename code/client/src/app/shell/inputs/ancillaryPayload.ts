import { resolveAncillaryInput } from "../../../ancillary/ancillaryInput";
import type { AncillaryField } from "../../../contracts/models";
import type { VisualMappingOptions } from "../../../render/mapping/visualMapping";

export const ERR_INVALID_ANCILLARY_JSON =
  "Ancillary JSON must include ancillary_schema and/or ancillary_by_node_id (legacy metadata aliases are also accepted).";

const KEY_METADATA_SCHEMA = "metadata_schema";
const KEY_METADATA_BY_NODE_ID = "metadata_by_node_id";
const KEY_VISUAL_MAPPING = "visual_mapping";

export interface AncillaryPayload {
  ancillarySchema?: AncillaryField[];
  ancillaryByNodeId?: Record<string, Record<string, string | number | boolean | null>>;
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
  const metadataSchema = record.ancillary_schema ?? record[KEY_METADATA_SCHEMA];
  const metadataByNodeId = record.ancillary_by_node_id ?? record[KEY_METADATA_BY_NODE_ID];
  const visualMapping = record[KEY_VISUAL_MAPPING];

  const hasSchema = Array.isArray(metadataSchema);
  const hasByNodeId =
    metadataByNodeId !== undefined && metadataByNodeId !== null && typeof metadataByNodeId === "object";

  if (!hasSchema && !hasByNodeId) {
    throw new Error(ERR_INVALID_ANCILLARY_JSON);
  }

  return {
    ...resolveAncillaryInput({
      ancillarySchema: record.ancillary_schema as AncillaryField[] | undefined,
      metadataSchema: record[KEY_METADATA_SCHEMA] as AncillaryField[] | undefined,
      ancillaryByNodeId: record.ancillary_by_node_id as
        Record<string, Record<string, string | number | boolean | null>> | undefined,
      metadataByNodeId: record[KEY_METADATA_BY_NODE_ID] as
        Record<string, Record<string, string | number | boolean | null>> | undefined,
    }),
    visual_mapping:
      visualMapping && typeof visualMapping === "object" ? (visualMapping as VisualMappingOptions) : undefined,
  };
}
