import { AUTOMATIC_GROUP_COLOR, MANUAL_BRANCH_COLOR } from '../../render/mapping/clusterNodes';
import { GROUP_SIZE_EXPLANATION } from '../node-summary/nodeSummary';
import { DISTANCE_CONNECTION_COLOR } from '../../render/mapping/distanceConnections';

export function renderGraphLegend(container: HTMLElement | null | undefined): void {
  if (!container) return;
  const symbols = document.createElement('ul');
  symbols.className = 'graph-symbols';
  for (const [label, color, shape] of [
    ['Automatic group (LoD)', AUTOMATIC_GROUP_COLOR, 'graph-symbol-triangle'],
    ['Manually collapsed branch', MANUAL_BRANCH_COLOR, 'graph-symbol-triangle'],
    ['Additional distance connection', DISTANCE_CONNECTION_COLOR, 'graph-symbol-line'],
  ]) {
    const item = document.createElement('li');
    const marker = document.createElement('span');
    marker.className = shape;
    marker.style.backgroundColor = color;
    marker.setAttribute('aria-hidden', 'true');
    item.append(marker, document.createTextNode(label));
    symbols.append(item);
  }
  const help = document.createElement('p');
  help.id = 'graph-symbol-help';
  help.textContent = `${GROUP_SIZE_EXPLANATION} Hover or select for exact available counts.`;
  container.replaceChildren(symbols, help);
}
