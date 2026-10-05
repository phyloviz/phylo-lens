import type { AncillaryData, AncillaryValue } from '../../../contracts/ancillary';

import { type AncillaryDistribution } from '../../../ancillary/ancillaryDistribution';
import { renderAncillaryWheel } from '../../../components/ancillary-wheel/AncillaryWheel';

export const REGION_PANEL_EMPTY_MESSAGE = 'Shift+drag (or enable Select region) on the canvas to isolate an area.';

export interface RegionPanelData {
    nodeCount: number;
    truncated: boolean;
    aggregatedAncillaryData: AncillaryData;
    ancillaryDistribution: AncillaryDistribution | null;
}

/** Display selected nodes, their ancillary distribution and server-provided aggregate values.
 * Passing null restores the selection prompt.
 */
export function renderRegionPanel(container: HTMLElement, data: RegionPanelData | null): void {
    if (!data) {
        const message = document.createElement('p');
        message.className = 'ancillary-wheel-empty';
        message.textContent = REGION_PANEL_EMPTY_MESSAGE;
        container.replaceChildren(message);
        return;
    }

    const summary = document.createElement('p');
    summary.className = 'region-panel-summary';
    const nodeLabel = data.nodeCount === 1 ? 'node' : 'nodes';
    summary.textContent = data.truncated
        ? `${data.nodeCount} ${nodeLabel} selected (truncated)`
        : `${data.nodeCount} ${nodeLabel} selected`;

    const wheelHost = document.createElement('div');
    renderAncillaryWheel(wheelHost, data.ancillaryDistribution, 'No ancillary pie data for the selected region.');

    container.innerHTML = '';
    container.appendChild(summary);
    container.appendChild(wheelHost);
    container.appendChild(buildAggregateTable(data.aggregatedAncillaryData));
}

function buildAggregateTable(aggregatedAncillaryData: AncillaryData): HTMLElement {
    const entries = Object.entries(aggregatedAncillaryData).sort(([left], [right]) => left.localeCompare(right));

    if (entries.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'ancillary-wheel-empty';
        empty.textContent = 'No aggregated ancillary data for this region.';
        return empty;
    }

    const table = document.createElement('table');
    table.className = 'region-aggregate-table';

    const head = document.createElement('tr');
    head.innerHTML = '<th>Field</th><th>Aggregate</th>';
    table.appendChild(head);

    entries.forEach(([field, value]) => {
        const row = document.createElement('tr');
        const fieldCell = document.createElement('td');
        fieldCell.textContent = field;
        const valueCell = document.createElement('td');
        valueCell.textContent = formatAggregateValue(value);
        row.appendChild(fieldCell);
        row.appendChild(valueCell);
        table.appendChild(row);
    });

    return table;
}

function formatAggregateValue(value: AncillaryValue): string {
    if (value === null) {
        return '—';
    }
    if (typeof value === 'number') {
        return Number.isInteger(value) ? String(value) : value.toFixed(3);
    }
    if (typeof value === 'boolean') {
        return value ? 'true' : 'false';
    }
    return value;
}
