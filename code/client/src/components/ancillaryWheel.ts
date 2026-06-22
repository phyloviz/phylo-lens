import type { PositionedGraph } from "../contracts/positioned";
import { readNodeMetadata } from "../ancillary/metadataAccess";
import {
  categoryCountsForField,
  categoricalPieValues,
  detectPieSliceKeys,
  isCategoryCountMetadataKey,
  PIE_ATTRIBUTE_PREFIX,
  PIE_OTHER_SLICE_KEY,
  PIE_OTHER_SLICE_COLOR,
  PIE_OTHER_SLICE_LABEL,
  pieCategoricalAttributeKey,
  resolvePieSliceColors,
} from "../render/pieMapping";

export interface AncillaryWheelSliceStat {
  key: string;
  label: string;
  value: number;
  percentage: number;
  color: string;
}

export interface AncillaryWheelStats {
  total: number;
  nodeCount: number;
  slices: AncillaryWheelSliceStat[];
}

export interface AncillaryWheelStatsOptions {
  includeNodeIds?: Set<string>;
}

export interface MetadataFieldSummary {
  key: string;
  uniqueValueCount: number;
}

const MAX_METADATA_DISTRIBUTION_SLICES = 12;
const GENERATED_METADATA_FIELDS = new Set(["profile_count"]);

// Aggregate pie-like ancillary attributes into one chart-friendly stats payload.
export function buildAncillaryWheelStats(
  graph: PositionedGraph,
  options: AncillaryWheelStatsOptions = {},
): AncillaryWheelStats | null {
  const totalsByKey = new Map<string, number>();
  const includeNodeIds = options.includeNodeIds;
  let includedNodeCount = 0;

  graph.nodes.forEach((node) => {
    if (includeNodeIds && !includeNodeIds.has(node.id)) {
      return;
    }

    includedNodeCount += 1;
    const attributes = node.attributes;
    if (!attributes) {
      return;
    }

    Object.entries(attributes).forEach(([key, value]) => {
      if (!key.startsWith(PIE_ATTRIBUTE_PREFIX) || typeof value !== "number") {
        return;
      }
      if (!Number.isFinite(value) || value <= 0) {
        return;
      }

      totalsByKey.set(key, (totalsByKey.get(key) ?? 0) + value);
    });
  });

  const keys = [...totalsByKey.keys()].sort((left, right) =>
    left.localeCompare(right),
  );
  if (keys.length === 0) {
    return null;
  }

  const total = keys.reduce((sum, key) => sum + (totalsByKey.get(key) ?? 0), 0);
  if (total <= 0) {
    return null;
  }

  const graphSliceKeys = detectPieSliceKeys(graph.nodes);
  const colors = resolvePieSliceColors(graph.nodes, graphSliceKeys);
  const displayedKeys = new Set(
    graphSliceKeys.filter((key) => key !== PIE_OTHER_SLICE_KEY),
  );
  const hasOtherSlice = graphSliceKeys.includes(PIE_OTHER_SLICE_KEY);
  const slices: AncillaryWheelSliceStat[] = keys.map((key) => {
    const value = totalsByKey.get(key) ?? 0;
    const percentage = (value / total) * 100;
    return {
      key,
      label: key.replace(PIE_ATTRIBUTE_PREFIX, ""),
      value,
      percentage,
      color:
        colors[key] ??
        (hasOtherSlice && !displayedKeys.has(key)
          ? colors[PIE_OTHER_SLICE_KEY]
          : undefined) ??
        "#0f766e",
    };
  });

  return {
    total,
    nodeCount: includedNodeCount,
    slices,
  };
}

// Aggregate one metadata field into a chart-friendly categorical distribution.
export function buildMetadataFieldWheelStats(
  graph: PositionedGraph,
  fieldKey: string,
  options: AncillaryWheelStatsOptions = {},
): AncillaryWheelStats | null {
  const trimmedFieldKey = fieldKey.trim();
  if (!trimmedFieldKey) {
    return null;
  }

  const countsByValue = new Map<string, number>();
  const includeNodeIds = options.includeNodeIds;
  let includedNodeCount = 0;

  graph.nodes.forEach((node) => {
    if (includeNodeIds && !includeNodeIds.has(node.id)) {
      return;
    }

    includedNodeCount += 1;
    const metadata = readNodeMetadata(node.attributes);
    if (!metadata) {
      return;
    }

    const categoryCounts = categoryCountsForField(metadata, trimmedFieldKey);
    if (categoryCounts.length > 0) {
      categoryCounts.forEach((entry) => {
        countsByValue.set(
          entry.category,
          (countsByValue.get(entry.category) ?? 0) + entry.count,
        );
      });
      return;
    }

    const value = metadata[trimmedFieldKey];
    if (value !== undefined && value !== null && value !== "") {
      categoricalPieValues(value).forEach((label) => {
        countsByValue.set(label, (countsByValue.get(label) ?? 0) + 1);
      });
    }
  });

  const slices = buildDistributionSlices(countsByValue);
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  if (total <= 0) {
    return null;
  }

  const graphSliceKeys = detectPieSliceKeys(graph.nodes);
  const colors = resolvePieSliceColors(graph.nodes, graphSliceKeys);
  return {
    total,
    nodeCount: includedNodeCount,
    slices: slices.map((slice) => ({
      ...slice,
      percentage: (slice.value / total) * 100,
      color:
        slice.label === PIE_OTHER_SLICE_LABEL
          ? PIE_OTHER_SLICE_COLOR
          : (() => {
              const key = pieCategoricalAttributeKey(
                trimmedFieldKey,
                slice.label,
              );
              return (
                colors[key] ??
                (graphSliceKeys.includes(PIE_OTHER_SLICE_KEY) &&
                !graphSliceKeys.includes(key)
                  ? colors[PIE_OTHER_SLICE_KEY]
                  : undefined) ??
                "#0f766e"
              );
            })(),
    })),
  };
}

// Return metadata keys visible in the current graph snapshot.
export function collectMetadataFieldKeys(graph: PositionedGraph): string[] {
  return collectMetadataFieldSummaries(graph).map((summary) => summary.key);
}

// Return metadata fields with approximate cardinality in the current graph.
export function collectMetadataFieldSummaries(
  graph: PositionedGraph,
): MetadataFieldSummary[] {
  const valuesByKey = new Map<string, Set<string>>();

  graph.nodes.forEach((node) => {
    const metadata = readNodeMetadata(node.attributes);
    if (!metadata) {
      return;
    }

    Object.entries(metadata).forEach(([key, value]) => {
      if (isGeneratedMetadataField(key)) {
        return;
      }

      const values = categoricalPieValues(value);
      const valueSet = valuesByKey.get(key) ?? new Set<string>();
      values.forEach((entry) => valueSet.add(entry));
      valuesByKey.set(key, valueSet);
    });
  });

  return [...valuesByKey.entries()]
    .map(([key, values]) => ({
      key,
      uniqueValueCount: values.size,
    }))
    .sort((left, right) => left.key.localeCompare(right.key));
}

function isGeneratedMetadataField(key: string): boolean {
  return GENERATED_METADATA_FIELDS.has(key) || isCategoryCountMetadataKey(key);
}

// Render a wheel (donut) and legend for aggregated ancillary percentages.
export function renderAncillaryWheel(
  container: HTMLElement,
  stats: AncillaryWheelStats | null,
  emptyMessage = "No ancillary pie data detected.",
): void {
  if (!stats) {
    container.innerHTML = `<p class="ancillary-wheel-empty">${escapeHtml(emptyMessage)}</p>`;
    return;
  }

  let offset = 0;
  const segments = stats.slices
    .map((slice) => {
      const start = offset;
      offset += slice.percentage;
      return `${slice.color} ${start.toFixed(2)}% ${offset.toFixed(2)}%`;
    })
    .join(", ");

  const legend = stats.slices
    .map(
      (slice) =>
        `<li><span class="dot" style="background:${slice.color}"></span><strong>${escapeHtml(
          slice.label,
        )}</strong><span>${slice.percentage.toFixed(1)}%</span></li>`,
    )
    .join("");

  container.innerHTML = `
    <div class="ancillary-wheel">
      <div class="wheel-chart" style="background: conic-gradient(${segments});">
        <div class="wheel-center">
          <span>Total</span>
          <strong>${stats.total.toFixed(1)}</strong>
        </div>
      </div>
      <div class="wheel-meta">
        <p>Ancillary distribution across ${stats.nodeCount} ${
          stats.nodeCount === 1 ? "node" : "nodes"
        }</p>
        <ul>${legend}</ul>
      </div>
    </div>
  `;
}

function buildDistributionSlices(
  countsByValue: Map<string, number>,
): Array<Omit<AncillaryWheelSliceStat, "percentage" | "color">> {
  const sorted = [...countsByValue.entries()].sort(
    ([leftLabel, leftCount], [rightLabel, rightCount]) =>
      rightCount - leftCount || leftLabel.localeCompare(rightLabel),
  );

  const topSlices = sorted.slice(0, MAX_METADATA_DISTRIBUTION_SLICES);
  const remaining = sorted.slice(MAX_METADATA_DISTRIBUTION_SLICES);
  const slices = topSlices.map(([label, value]) => ({
    key: label,
    label,
    value,
  }));

  const otherValue = remaining.reduce((sum, [, value]) => sum + value, 0);
  if (otherValue > 0) {
    slices.push({
      key: PIE_OTHER_SLICE_LABEL,
      label: PIE_OTHER_SLICE_LABEL,
      value: otherValue,
    });
  }

  return slices;
}

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
