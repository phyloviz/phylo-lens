import { AUTOMATIC_GROUP_COLOR, MANUAL_BRANCH_COLOR } from '../../render/mapping/clusterNodes';
import { GROUP_SIZE_EXPLANATION } from '../node-summary/nodeSummary';

export function renderGraphLegend(container: HTMLElement | null | undefined): void {
  if (!container) return;
  const symbols = document.createElement('ul');
  symbols.className = 'graph-symbols';
  for (const [label, color] of [
    ['Automatic group (LoD)', AUTOMATIC_GROUP_COLOR],
    ['Manually collapsed branch', MANUAL_BRANCH_COLOR],
  ]) {
    const item = document.createElement('li');
    const marker = document.createElement('span');
    marker.className = 'graph-symbol-triangle';
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
