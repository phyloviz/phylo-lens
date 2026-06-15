import { readNodeMetadata } from "../../../ancillary/metadataAccess";
import type { PositionedGraph } from "../../../contracts/positioned";
import {
  categoryCountsForField,
  categoricalPieValues,
  MAX_PIE_SLICE_KEYS,
  PIE_OTHER_SLICE_LABEL,
} from "../../../render/pieMapping";

const HIGH_CARDINALITY_PIE_FIELD_THRESHOLD = 24;

export interface CategorySummary {
  label: string;
  count: number;
  percentage: number;
  color?: string;
}

export function formatPieFieldOption(summary: {
  key: string;
  uniqueValueCount: number;
}): string {
  const suffix =
    summary.uniqueValueCount > HIGH_CARDINALITY_PIE_FIELD_THRESHOLD
      ? "many values"
      : `${summary.uniqueValueCount} values`;
  return `${summary.key} (${suffix})`;
}

export function buildCategorySummaries(
  graph: PositionedGraph,
  fieldKey: string,
): CategorySummary[] {
  const countsByCategory = new Map<string, number>();
  graph.nodes.forEach((node) => {
    const metadata = readNodeMetadata(node.attributes);
    if (!metadata) {
      return;
    }

    const categoryCounts = categoryCountsForField(metadata, fieldKey);
    if (categoryCounts.length > 0) {
      categoryCounts.forEach((entry) => {
        countsByCategory.set(
          entry.category,
          (countsByCategory.get(entry.category) ?? 0) + entry.count,
        );
      });
      return;
    }

    const value = metadata[fieldKey];
    categoricalPieValues(value).forEach((category) => {
      countsByCategory.set(category, (countsByCategory.get(category) ?? 0) + 1);
    });
  });

  const total = [...countsByCategory.values()].reduce(
    (sum, count) => sum + count,
    0,
  );
  if (total <= 0) {
    return [];
  }

  const sorted = [...countsByCategory.entries()].sort(
    ([leftLabel, leftCount], [rightLabel, rightCount]) =>
      rightCount - leftCount || leftLabel.localeCompare(rightLabel),
  );
  const hasOverflow = sorted.length > MAX_PIE_SLICE_KEYS;
  const topCategoryLimit = hasOverflow
    ? Math.max(0, MAX_PIE_SLICE_KEYS - 1)
    : MAX_PIE_SLICE_KEYS;
  const topCategories = sorted.slice(0, topCategoryLimit);
  const remainingCategories = sorted.slice(topCategoryLimit);
  const summaries = topCategories.map(([label, count]) => ({
    label,
    count,
    percentage: (count / total) * 100,
  }));
  const otherCount = remainingCategories.reduce(
    (sum, [, count]) => sum + count,
    0,
  );

  if (otherCount > 0) {
    summaries.push({
      label: PIE_OTHER_SLICE_LABEL,
      count: otherCount,
      percentage: (otherCount / total) * 100,
    });
  }

  return summaries;
}
