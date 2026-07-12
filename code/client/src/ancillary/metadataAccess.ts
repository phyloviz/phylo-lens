import type { NodeMetadata } from "./metadataTypes";

const METADATA_ATTRIBUTE_KEY = "metadata";

export function readNodeMetadata(attributes: Record<string, unknown> | undefined): NodeMetadata | null {
  const metadata = attributes?.[METADATA_ATTRIBUTE_KEY];

  if (metadata == null || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }

  return metadata as NodeMetadata;
}
