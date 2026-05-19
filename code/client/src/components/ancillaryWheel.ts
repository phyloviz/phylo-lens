import type { PositionedGraph } from "../contracts/positioned";
import {
  buildPiePalette,
  PIE_ATTRIBUTE_PREFIX,
  PIE_PALETTE_ATTRIBUTE,
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

// Aggregate pie-like ancillary attributes into one chart-friendly stats payload.
export function buildAncillaryWheelStats(
  graph: PositionedGraph,
  options: AncillaryWheelStatsOptions = {},
): AncillaryWheelStats | null {
  const totalsByKey = new Map<string, number>();
  const includeNodeIds = options.includeNodeIds;

  graph.nodes.forEach((node) => {
    if (includeNodeIds && !includeNodeIds.has(node.id)) {
      return;
    }

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

  const runtimePalette = resolvePaletteFromGraph(graph);
  const palette = buildPiePalette(keys.length, runtimePalette);
  const slices: AncillaryWheelSliceStat[] = keys.map((key, index) => {
    const value = totalsByKey.get(key) ?? 0;
    const percentage = (value / total) * 100;
    return {
      key,
      label: key.replace(PIE_ATTRIBUTE_PREFIX, ""),
      value,
      percentage,
      color: palette[index] ?? "#0f766e",
    };
  });

  return {
    total,
    nodeCount: graph.nodes.length,
    slices,
  };
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
        <p>Ancillary distribution across ${stats.nodeCount} nodes</p>
        <ul>${legend}</ul>
      </div>
    </div>
  `;
}

function resolvePaletteFromGraph(graph: PositionedGraph): string[] | undefined {
  for (const node of graph.nodes) {
    const paletteValue = node.attributes?.[PIE_PALETTE_ATTRIBUTE];
    if (!Array.isArray(paletteValue)) {
      continue;
    }

    const colors = paletteValue.filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    );
    if (colors.length > 0) {
      return colors;
    }
  }

  return undefined;
}

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
