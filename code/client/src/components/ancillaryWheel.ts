import type { PositionedGraph } from "../contracts/positioned";
import { readNodeAncillaryValues } from "../ancillary/ancillaryAccess";
import {
  distributionForFields,
  pieGroupingForFields,
  PIE_GROUPING_ATTRIBUTE,
  type PieCategoryGrouping,
  observationsFromAttributes,
  distributionFromAttributes,
  detectPieSliceKeys,
  resolvePieSliceColors,
  PIE_ATTRIBUTE_PREFIX,
  PIE_DISTRIBUTION_ATTRIBUTE,
  PIE_OTHER_SLICE_KEY,
  PIE_OTHER_SLICE_LABEL,
  isCategoryCountMetadataKey,
  type PieCategory,
} from "../render/mapping/pieMapping";

export interface AncillaryWheelSliceStat extends PieCategory {
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
  fields?: string[];
  palette?: string[];
  categoryColors?: Record<string, string>;
  categoryGrouping?: PieCategoryGrouping;
  groupCategories?: boolean;
}
export interface AncillaryFieldSummary {
  key: string;
  uniqueValueCount: number;
}

export function buildAncillaryWheelStats(
  graph: PositionedGraph,
  options: AncillaryWheelStatsOptions = {},
): AncillaryWheelStats | null {
  const grouping = options.categoryGrouping
    ? pieGroupingForFields(options.fields ?? [], options.categoryGrouping)
    : undefined;
  const nodes = graph.nodes.map((node) => {
    const distribution = options.fields
      ? distributionForFields(node.attributes, options.fields)
      : distributionFromAttributes(node.attributes);
    return {
      ...node,
      attributes: options.fields
        ? {
            ...Object.fromEntries(
              Object.entries(node.attributes ?? {}).filter(([key]) => !key.startsWith(PIE_ATTRIBUTE_PREFIX)),
            ),
            ...Object.fromEntries(distribution.map((slice) => [slice.key, slice.value])),
            [PIE_DISTRIBUTION_ATTRIBUTE]: distribution,
            ...(grouping ? { [PIE_GROUPING_ATTRIBUTE]: grouping } : {}),
          }
        : node.attributes,
    };
  });
  // The same displayed keys drive the GPU and every legend, including Other.
  const keys =
    options.groupCategories === false
      ? [...new Set(nodes.flatMap((node) => distributionFromAttributes(node.attributes).map((slice) => slice.key)))]
      : detectPieSliceKeys(nodes);
  const displayed = new Set(keys);
  const colors = resolvePieSliceColors(nodes, keys, options.palette, options.categoryColors);
  const totals = new Map<string, PieCategory>();
  let nodeCount = 0;
  for (const node of nodes) {
    if (options.includeNodeIds && !options.includeNodeIds.has(node.id)) continue;
    nodeCount += 1;
    const distribution = distributionFromAttributes(node.attributes);
    const slices = distribution.length
      ? distribution
      : Object.entries(node.attributes ?? {}).flatMap(([key, value]) =>
          key.startsWith(PIE_ATTRIBUTE_PREFIX) && typeof value === "number" && value > 0
            ? [{ key, category: key, label: key.slice(PIE_ATTRIBUTE_PREFIX.length), value }]
            : [],
        );
    for (const slice of slices) {
      const key = displayed.has(slice.key) ? slice.key : PIE_OTHER_SLICE_KEY;
      const entry =
        key === PIE_OTHER_SLICE_KEY ? { ...slice, key, category: key, label: PIE_OTHER_SLICE_LABEL } : slice;
      totals.set(key, { ...entry, value: (totals.get(key)?.value ?? 0) + slice.value });
    }
  }
  const total = [...totals.values()].reduce((sum, slice) => sum + slice.value, 0);
  if (!total) return null;
  return {
    total,
    nodeCount,
    slices: [...totals.values()]
      .sort((a, b) => b.value - a.value || a.key.localeCompare(b.key))
      .map((slice) => ({ ...slice, percentage: (slice.value / total) * 100, color: colors[slice.key] })),
  };
}

export function buildAncillaryFieldWheelStats(
  graph: PositionedGraph,
  field: string,
  options: AncillaryWheelStatsOptions = {},
): AncillaryWheelStats | null {
  return field.trim() ? buildAncillaryWheelStats(graph, { ...options, fields: [field] }) : null;
}

export function collectMetadataFieldKeys(graph: PositionedGraph): string[] {
  return collectAncillaryFieldSummaries(graph).map((summary) => summary.key);
}

export function collectAncillaryFieldSummaries(graph: PositionedGraph): AncillaryFieldSummary[] {
  const valuesByKey = new Map<string, Set<string>>();
  for (const node of graph.nodes) {
    const observations = observationsFromAttributes(node.attributes);
    const rows = observations.length
      ? observations.map((row) => row.values)
      : [readNodeAncillaryValues(node.attributes)];
    for (const row of rows)
      for (const [field, value] of Object.entries(row)) {
        if (field === "profile_count" || isCategoryCountMetadataKey(field)) continue;
        const values = valuesByKey.get(field) ?? new Set<string>();
        if (value != null && String(value).trim()) values.add(String(value));
        valuesByKey.set(field, values);
      }
  }
  return [...valuesByKey]
    .map(([key, values]) => ({ key, uniqueValueCount: values.size }))
    .sort((a, b) => a.key.localeCompare(b.key));
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
        )}</strong><span>n = ${slice.value.toLocaleString()} · ${slice.percentage.toFixed(1)}%</span></li>`,
    )
    .join("");

  container.innerHTML = `
    <div class="ancillary-wheel">
      <div class="wheel-chart" style="background: conic-gradient(${segments});">
        <div class="wheel-center">
          <span>Observations</span>
          <strong>${stats.total.toLocaleString()}</strong>
        </div>
      </div>
      <div class="wheel-meta">
        <p>Ancillary distribution across ${stats.nodeCount} ${stats.nodeCount === 1 ? "node" : "nodes"}</p>
        <ul>${legend}</ul>
      </div>
    </div>
  `;
}

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/** @deprecated Use the corresponding Ancillary* names. */
export const buildMetadataFieldWheelStats = buildAncillaryFieldWheelStats;
export const collectMetadataFieldSummaries = collectAncillaryFieldSummaries;
export type MetadataFieldSummary = AncillaryFieldSummary;
