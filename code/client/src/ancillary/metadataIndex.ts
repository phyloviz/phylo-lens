/** @deprecated Use ancillaryIndex. */
export {
  buildAncillaryIndex as buildMetadataIndex,
  getNodeAncillaryData as getNodeMetadata,
  filterNodeIdsByFieldValues,
} from "./ancillaryIndex";
export type { AncillaryIndex as MetadataIndexData } from "./ancillaryIndex";
