import { readNodeAnnotations, readNodeIsolates } from '../../../ancillary/ancillaryAccess';
import type { PositionedNode } from '../../../contracts/positioned';

type NodeDetails = {
  readonly title: string;
  readonly summary: string;
  readonly isolateIds: readonly string[];
};

export function renderNodeDetails(container: HTMLElement, node: PositionedNode): void {
  const { title, summary, isolateIds } = describeNode(node);
  const heading = document.createElement('p');
  heading.className = 'node-details-title';
  heading.textContent = title;
  const counts = document.createElement('p');
  counts.textContent = summary;
  container.append(heading, counts);

  if (isolateIds.length > 0) container.append(createIsolateDetails(isolateIds));
}

function describeNode(node: PositionedNode): NodeDetails {
  const memberCount = node.attributes?.memberCount;
  const isCluster = typeof memberCount === 'number' && memberCount > 1;
  const isolateIds = readNodeIsolates(node.attributes).map(isolate => isolate.id);
  const reportedIsolateCount = readNodeAnnotations(node.attributes).profileSummary.isolateCount;
  const isolateCount =
    typeof reportedIsolateCount === 'number' && Number.isSafeInteger(reportedIsolateCount) && reportedIsolateCount > 0
      ? reportedIsolateCount
      : isolateIds.length;

  let kind = 'Node';
  if (isCluster) kind = 'Cluster';
  else if (isolateIds.length > 0) kind = 'Profile';

  const counts: string[] = [];
  if (isCluster) counts.push(`${memberCount} nodes`);
  if (isolateCount > 0) counts.push(`${isolateCount} ${isolateCount === 1 ? 'isolate' : 'isolates'}`);

  return {
    title: `${kind}: ${node.id}`,
    summary: counts.join(' · '),
    // A LoD cluster represents several nodes, so it has no single profile's isolate list.
    isolateIds: isCluster ? [] : isolateIds,
  };
}

function createIsolateDetails(isolateIds: readonly string[]): HTMLDetailsElement {
  const details = document.createElement('details');
  details.className = 'node-isolate-details';
  const summary = document.createElement('summary');
  summary.textContent = `Original isolate IDs (${isolateIds.length})`;
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
