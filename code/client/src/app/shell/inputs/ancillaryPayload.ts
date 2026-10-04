import { resolveAncillaryInput } from "../../../ancillary/ancillaryInput";
import type { AncillaryField } from "../../../contracts/models";
import type { VisualMappingOptions } from "../../../render/mapping/visualMapping";

export const ERR_INVALID_ANCILLARY_JSON = "Ancillary JSON must include ancillary_schema and/or ancillary_by_node_id.";

const KEY_VISUAL_MAPPING = "visual_mapping";

export interface AncillaryPayload {
  ancillarySchema?: readonly AncillaryField[];
  ancillaryByNodeId?: Readonly<Record<string, Record<string, string | number | boolean | null>>>;
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
  const metadataSchema = record.ancillary_schema;
  const metadataByNodeId = record.ancillary_by_node_id;
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
      ancillaryByNodeId: record.ancillary_by_node_id as
        Record<string, Record<string, string | number | boolean | null>> | undefined,
    }),
    visual_mapping:
      visualMapping && typeof visualMapping === "object" ? (visualMapping as VisualMappingOptions) : undefined,
  };
}
