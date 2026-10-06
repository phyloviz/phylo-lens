import type { AncillaryData, AncillaryField } from '../../../contracts/ancillary';
import type { VisualMappingOptions } from '../../../render/mapping/visualMapping';
import { isAncillaryByNodeId, isAncillarySchema } from '../../../validation/ancillaryGuards';
import { isRecord } from '../../../validation/guards';
import { isVisualMapping } from '../../../validation/visualMappingGuards';

export const ERR_INVALID_ANCILLARY_JSON = 'Ancillary JSON must include ancillary_schema and/or ancillary_by_node_id.';
export const ERR_INVALID_VISUAL_MAPPING = 'Ancillary JSON contains an invalid visual mapping.';

export type AncillaryPayload = {
  ancillarySchema?: readonly AncillaryField[];
  ancillaryByNodeId?: Readonly<Record<string, AncillaryData>>;
  visualMapping?: VisualMappingOptions;
};

/** User input is unknown until its columns, values and mapping options have been checked. */
export function parseAncillaryPayload(rawInput: string): AncillaryPayload {
  if (!rawInput) return {};
  const parsed: unknown = JSON.parse(rawInput);
  if (!isRecord(parsed)) throw new Error(ERR_INVALID_ANCILLARY_JSON);
  const schema = parsed.ancillary_schema;
  const values = parsed.ancillary_by_node_id;
  const mapping = parsed.visual_mapping;
  if (schema === undefined && values === undefined) throw new Error(ERR_INVALID_ANCILLARY_JSON);
  if (schema !== undefined && !isAncillarySchema(schema)) throw new Error(ERR_INVALID_ANCILLARY_JSON);
  if (values !== undefined && !isAncillaryByNodeId(values)) throw new Error(ERR_INVALID_ANCILLARY_JSON);
  if (mapping !== undefined && !isVisualMapping(mapping)) throw new Error(ERR_INVALID_VISUAL_MAPPING);
  return { ancillarySchema: schema ?? [], ancillaryByNodeId: values ?? {}, visualMapping: mapping };
}
