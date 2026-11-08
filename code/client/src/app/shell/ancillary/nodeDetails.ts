import { readNodeIsolates } from '../../../ancillary/ancillaryAccess';
import type { PositionedNode } from '../../../contracts/positioned';
import { nodeSummary } from '../../../components/node-summary/nodeSummary';

export function renderNodeDetails(container: HTMLElement, node: PositionedNode): void {
  const summary = nodeSummary(node.attributes);
  const heading = document.createElement('p');
  heading.className = 'node-details-title';
  heading.textContent = `${summary.label}: ${node.id}`;
  const counts = document.createElement('dl');
  counts.className = 'node-counts';
  for (const count of summary.counts) {
    const label = document.createElement('dt');
    label.textContent = count.label;
    const value = document.createElement('dd');
    value.textContent = count.value;
    counts.append(label, value);
  }
  container.append(heading, counts);
  for (const text of summary.notes) {
    const note = document.createElement('p');
    note.className = 'node-details-note';
    note.textContent = text;
    container.append(note);
  }
  const isolateIds = readNodeIsolates(node.attributes).map(isolate => isolate.id);
  if (summary.kind !== 'automatic-group' && isolateIds.length > 0)
    container.append(createIsolateDetails(isolateIds, summary.kind === 'manual-branch'));
}

function createIsolateDetails(isolateIds: readonly string[], rootOnly: boolean): HTMLDetailsElement {
  const details = document.createElement('details');
  details.className = 'node-isolate-details';
  const summary = document.createElement('summary');
  summary.textContent = `${rootOnly ? 'Root node isolate IDs' : 'Original isolate IDs'} (${isolateIds.length})`;
  const list = document.createElement('ul');
  list.className = 'node-isolate-list';
  // Large profiles can have many isolate IDs. Create list items only when requested.
  details.addEventListener('toggle', () => {
    if (!details.open || list.childElementCount > 0) return;
    for (const isolateId of isolateIds) {
      const item = document.createElement('li');
      item.textContent = isolateId;
      list.append(item);
    }
  });
  details.append(summary, list);
  return details;
}
