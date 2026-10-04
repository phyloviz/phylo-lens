import type { AncillaryData, NodeAnnotations } from "../contracts/ancillary";
import { decodeApiMetadata } from "./apiMetadata";

/** Read typed node annotations or decode flat API metadata supplied to a renderer. */
export function readNodeAnnotations(attributes: Record<string, unknown> | undefined): NodeAnnotations {
  const annotations = attributes?.annotations;
  if (
    annotations &&
    typeof annotations === "object" &&
    "ancillaryData" in annotations &&
    "ancillarySummary" in annotations &&
    "profileSummary" in annotations
  ) {
    return annotations as NodeAnnotations;
  }
  const metadata = attributes?.metadata;
  return decodeApiMetadata(
    metadata && typeof metadata === "object" && !Array.isArray(metadata) ? (metadata as AncillaryData) : {},
  );
}

export function readNodeAncillaryValues(attributes: Record<string, unknown> | undefined): AncillaryData {
  return ancillaryValues(readNodeAnnotations(attributes));
}

/** Effective node values for filtering/display; original isolate rows stay separate. */
export function ancillaryValues(annotations: NodeAnnotations): AncillaryData {
  return { ...annotations.ancillarySummary.values, ...annotations.ancillaryData };
}
