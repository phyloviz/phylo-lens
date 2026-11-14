import { AUTOMATIC_GROUP_COLOR, MANUAL_BRANCH_COLOR } from '../../render/mapping/clusterNodes';
import { GROUP_SIZE_EXPLANATION } from '../node-summary/nodeSummary';
import { DISTANCE_CONNECTION_COLOR } from '../../render/mapping/distanceConnections';
import type { PositionedGraph } from '../../contracts/positioned';

export function createGraphLegend(container: HTMLElement | null | undefined): {
  update(graph: PositionedGraph | null): void;
} {
  if (!container) return { update: () => {} };
  const root = container;
  const symbols = document.createElement('ul');
  symbols.className = 'graph-symbols';
  const entries: HTMLLIElement[] = [];
  for (const [label, color, shape] of [
    ['Automatic group', AUTOMATIC_GROUP_COLOR, 'graph-symbol-triangle'],
    ['Collapsed branch', MANUAL_BRANCH_COLOR, 'graph-symbol-triangle'],
    ['Additional connection', DISTANCE_CONNECTION_COLOR, 'graph-symbol-line'],
  ]) {
    const item = document.createElement('li');
    const marker = document.createElement('span');
    marker.className = shape;
    marker.style.backgroundColor = color;
    marker.setAttribute('aria-hidden', 'true');
    item.append(marker, document.createTextNode(label));
    symbols.append(item);
    entries.push(item);
  }
  const about = document.createElement('details');
  about.className = 'graph-symbol-help';
  const summary = document.createElement('summary');
  summary.textContent = 'About symbols';
  const help = document.createElement('p');
  help.id = 'graph-symbol-help';
  help.textContent = `${GROUP_SIZE_EXPLANATION} Automatic groups change with the detail level; collapsed branches are folds you made. Hover or select for exact available counts.`;
  about.append(summary, help);
  container.replaceChildren(symbols, about);
  update(null);
  return { update };

  function update(graph: PositionedGraph | null): void {
    const present = [
      graph?.nodes.some(node => node.attributes?.isClusterProxy === true && node.attributes.isBranchCollapsed !== true),
      graph?.nodes.some(node => node.attributes?.isBranchCollapsed === true),
      graph?.edges.some(edge => edge.attributes?.isDistanceConnection === true),
    ];
    entries.forEach((item, index) => {
      item.hidden = !present[index];
    });
    root.hidden = !present.some(Boolean);
    // Keep the disclosure node and its open state across streamed updates.
  }
}
