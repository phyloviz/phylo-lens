import type { PositionedGraph } from "../contracts/positioned";
import { readNodeMetadata } from "../ancillary/metadataAccess";
import { buildValueColorMap, DEFAULT_COLOR_PALETTE } from "../render/colorHash";
import {
  categoryCountsForField,
  categoricalPieValues,
  collectPieCategoryColors,
  detectPieSliceKeys,
  isCategoryCountMetadataKey,
  PIE_ATTRIBUTE_PREFIX,
  PIE_OTHER_SLICE_KEY,
  PIE_OTHER_SLICE_COLOR,
  PIE_OTHER_SLICE_LABEL,
  pieCategoricalAttributeKey,
  resolvePiePaletteFromNodes,
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
  // Live palette + per-category colour overrides from the shell controls. The
  // wheel graph snapshot does not carry the user's palette edits on its nodes,
  // so the shell passes them here to keep the wheel in lock-step with the tree
  // when a colour is changed. Category overrides win over the ranked palette,
  // exactly as they do for the node fill.
  palette?: string[];
  categoryColors?: Record<string, string>;
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
  const colors = resolvePieSliceColors(
    graph.nodes,
    graphSliceKeys,
    options.palette,
    options.categoryColors,
  );
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

  const includeNodeIds = options.includeNodeIds;
  const countsByValue = new Map<string, number>();
  let includedNodeCount = 0;

  graph.nodes.forEach((node) => {
    if (includeNodeIds && !includeNodeIds.has(node.id)) {
      return;
    }

    includedNodeCount += 1;
    accumulateFieldCounts(node.attributes, trimmedFieldKey, countsByValue);
  });

  const slices = buildDistributionSlices(countsByValue);
  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  if (total <= 0) {
    return null;
  }

  const colorForValue = buildFieldValueColorResolver(
    graph,
    trimmedFieldKey,
    options,
  );
  return {
    total,
    nodeCount: includedNodeCount,
    slices: slices.map((slice) => ({
      ...slice,
      percentage: (slice.value / total) * 100,
      color:
        slice.label === PIE_OTHER_SLICE_LABEL
          ? PIE_OTHER_SLICE_COLOR
          : colorForValue(slice.label),
    })),
  };
}

// Aggregate a single node's contribution to one field's value distribution.
function accumulateFieldCounts(
  attributes: Record<string, unknown> | undefined,
  fieldKey: string,
  countsByValue: Map<string, number>,
): void {
  const metadata = readNodeMetadata(attributes);
  if (!metadata) {
    return;
  }

  const categoryCounts = categoryCountsForField(metadata, fieldKey);
  if (categoryCounts.length > 0) {
    categoryCounts.forEach((entry) => {
      countsByValue.set(
        entry.category,
        (countsByValue.get(entry.category) ?? 0) + entry.count,
      );
    });
    return;
  }

  const value = metadata[fieldKey];
  if (value !== undefined && value !== null && value !== "") {
    categoricalPieValues(value).forEach((label) => {
      countsByValue.set(label, (countsByValue.get(label) ?? 0) + 1);
    });
  }
}

// Resolve a per-value color that matches the node's solid fill exactly. The
// renderer ranks fieldKey's values by graph-wide frequency and assigns palette
// colours in order; the on-node pie and this wheel rank the SAME way, so a
// value (e.g. "Peru") gets one colour everywhere and the top values stay
// distinct. User category-colour overrides win, as they do for the node.
function buildFieldValueColorResolver(
  graph: PositionedGraph,
  fieldKey: string,
  options: AncillaryWheelStatsOptions = {},
): (value: string) => string {
  // A live palette from the shell controls wins over one baked onto the graph
  // snapshot, so palette edits recolour the wheel immediately (matching the
  // tree, which the shell repaints through the same override).
  const runtimePalette =
    options.palette && options.palette.length > 0
      ? options.palette
      : resolvePiePaletteFromNodes(graph.nodes);
  const palette =
    runtimePalette && runtimePalette.length > 0
      ? runtimePalette
      : DEFAULT_COLOR_PALETTE;
  // Category overrides come from two places, both keyed by the pie attribute
  // key: what's baked on the graph and the live shell edits (keyed by label,
  // so we re-key them per field here). Live edits take precedence.
  const graphCategoryColors = collectPieCategoryColors(graph.nodes);
  const optionCategoryColors: Record<string, string> = {};
  if (options.categoryColors) {
    for (const [label, color] of Object.entries(options.categoryColors)) {
      optionCategoryColors[pieCategoricalAttributeKey(fieldKey, label)] = color;
    }
  }
  const categoryColors = { ...graphCategoryColors, ...optionCategoryColors };

  // Gather one value per node occurrence so buildValueColorMap ranks by the
  // field's true graph-wide frequency (mirroring the node-fill ranking).
  const values = collectFieldValues(graph, fieldKey);
  const colorForValue = buildValueColorMap(values, palette);

  return (value: string) =>
    categoryColors[pieCategoricalAttributeKey(fieldKey, value)] ??
    colorForValue(value);
}

// Collect one entry per occurrence of fieldKey across all nodes, so the ranked
// colour map reflects true frequency. Uses the same accumulation as the wheel's
// value counting to stay consistent with what the legend shows.
function collectFieldValues(
  graph: PositionedGraph,
  fieldKey: string,
): string[] {
  const countsByValue = new Map<string, number>();
  graph.nodes.forEach((node) => {
    accumulateFieldCounts(node.attributes, fieldKey, countsByValue);
  });

  const values: string[] = [];
  countsByValue.forEach((count, label) => {
    for (let index = 0; index < count; index += 1) {
      values.push(label);
    }
  });
  return values;
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
