import type { GraphMetadataValue } from "../../../api/graphContracts";
import {
  type AncillaryWheelStats,
  renderAncillaryWheel,
} from "../../../components/ancillaryWheel";

export const REGION_PANEL_EMPTY_MESSAGE =
  "Shift+drag (or enable Select region) on the canvas to isolate an area.";

export interface RegionPanelData {
  nodeCount: number;
  truncated: boolean;
  aggregatedMetadata: Record<string, GraphMetadataValue>;
  wheelStats: AncillaryWheelStats | null;
}

// Render the region-selection summary: a node-count header, a donut of the
// selected set's ancillary distribution, and a table of the server-aggregated
// metadata (mean for numeric fields, mode otherwise). Passing null resets the
// panel to its empty prompt.
export function renderRegionPanel(
  container: HTMLElement,
  data: RegionPanelData | null,
): void {
  if (!data) {
    container.innerHTML = `<p class="ancillary-wheel-empty">${escapeHtml(
      REGION_PANEL_EMPTY_MESSAGE,
    )}</p>`;
    return;
  }

  const summary = document.createElement("p");
  summary.className = "region-panel-summary";
  const nodeLabel = data.nodeCount === 1 ? "node" : "nodes";
  summary.textContent = data.truncated
    ? `${data.nodeCount} ${nodeLabel} selected (truncated)`
    : `${data.nodeCount} ${nodeLabel} selected`;

  const wheelHost = document.createElement("div");
  renderAncillaryWheel(
    wheelHost,
    data.wheelStats,
    "No ancillary pie data for the selected region.",
  );

  container.innerHTML = "";
  container.appendChild(summary);
  container.appendChild(wheelHost);
  container.appendChild(buildAggregateTable(data.aggregatedMetadata));
}

function buildAggregateTable(
  aggregatedMetadata: Record<string, GraphMetadataValue>,
): HTMLElement {
  const entries = Object.entries(aggregatedMetadata).sort(([left], [right]) =>
    left.localeCompare(right),
  );

  if (entries.length === 0) {
    const empty = document.createElement("p");
    empty.className = "ancillary-wheel-empty";
    empty.textContent = "No aggregated metadata for this region.";
    return empty;
  }

  const table = document.createElement("table");
  table.className = "region-aggregate-table";

  const head = document.createElement("tr");
  head.innerHTML = "<th>Field</th><th>Aggregate</th>";
  table.appendChild(head);

  entries.forEach(([field, value]) => {
    const row = document.createElement("tr");
    const fieldCell = document.createElement("td");
    fieldCell.textContent = field;
    const valueCell = document.createElement("td");
    valueCell.textContent = formatAggregateValue(value);
    row.appendChild(fieldCell);
    row.appendChild(valueCell);
    table.appendChild(row);
  });

  return table;
}

function formatAggregateValue(value: GraphMetadataValue): string {
  if (value === null) {
    return "—";
  }
  if (typeof value === "number") {
    return Number.isInteger(value) ? String(value) : value.toFixed(3);
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return value;
}

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
