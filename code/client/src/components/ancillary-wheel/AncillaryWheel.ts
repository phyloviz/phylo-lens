import type { AncillaryDistribution } from '../../ancillary/ancillaryDistribution';

// Render a wheel (donut) and legend for aggregated ancillary percentages.
export function renderAncillaryWheel(
    container: HTMLElement,
    distribution: AncillaryDistribution | null,
    emptyMessage = 'No ancillary pie data detected.'
): void {
    if (!distribution) {
        container.innerHTML = `<p class="ancillary-wheel-empty">${escapeHtml(emptyMessage)}</p>`;
        return;
    }

    let offset = 0;
    const segments = distribution.categories
        .map(slice => {
            const start = offset;
            offset += slice.percentage;
            return `${slice.color} ${start.toFixed(2)}% ${offset.toFixed(2)}%`;
        })
        .join(', ');

    const legend = distribution.categories
        .map(
            slice =>
                `<li><span class="dot" style="background:${slice.color}"></span><strong>${escapeHtml(
                    slice.label
                )}</strong><span>n = ${slice.count.toLocaleString()} · ${slice.percentage.toFixed(1)}%</span></li>`
        )
        .join('');

    container.innerHTML = `
    <div class="ancillary-wheel">
      <div class="wheel-chart" style="background: conic-gradient(${segments});">
        <div class="wheel-center">
          <span>Observations</span>
          <strong>${distribution.observationCount.toLocaleString()}</strong>
        </div>
      </div>
      <div class="wheel-meta">
        <p>Ancillary distribution across ${distribution.nodeCount} ${distribution.nodeCount === 1 ? 'node' : 'nodes'}</p>
        <ul>${legend}</ul>
      </div>
    </div>
  `;
}

function escapeHtml(input: string): string {
    return input
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}
