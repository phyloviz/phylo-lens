import type { AncillaryData, NodeAnnotations } from "../contracts/ancillary";

const CATEGORY_PREFIX = "__category_count__";
const CATEGORY_SEPARATOR = "__value__";

/** Decode API v1 / stored layouts once, before data reaches domain consumers. */
export function decodeLegacyMetadata(metadata: AncillaryData = {}): NodeAnnotations {
  const ancillaryData = new Map<string, AncillaryData[string]>();
  const categoryCounts = new Map<string, Map<string, number>>();
  let isolateCount: number | undefined;
  for (const [key, value] of Object.entries(metadata)) {
    if (key === "profile_count") {
      if (isPositiveCount(value)) isolateCount = value;
    } else if (key.startsWith(CATEGORY_PREFIX)) {
      const encoded = key.slice(CATEGORY_PREFIX.length);
      const separator = encoded.indexOf(CATEGORY_SEPARATOR);
      if (separator < 0 || !isPositiveCount(value)) continue;
      try {
        const field = decodeURIComponent(encoded.slice(0, separator));
        const category = decodeURIComponent(encoded.slice(separator + CATEGORY_SEPARATOR.length));
        const counts = categoryCounts.get(field) ?? new Map<string, number>();
        counts.set(category, value);
        categoryCounts.set(field, counts);
      } catch {
        /* Malformed legacy fields are not user observations. */
      }
    } else {
      ancillaryData.set(key, value);
    }
  }
  return {
    ancillaryData: categoryCounts.size || isolateCount !== undefined ? {} : Object.fromEntries(ancillaryData),
    ancillarySummary: {
      values: categoryCounts.size || isolateCount !== undefined ? Object.fromEntries(ancillaryData) : {},
      categoryCounts: Object.fromEntries(
        [...categoryCounts].map(([field, counts]) => [field, Object.fromEntries(counts)]),
      ),
    },
    profileSummary: { isolateCount },
  };
}

function isPositiveCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
