import { readNodeIsolateCount } from '../../ancillary/ancillaryAccess';

type CountDetail = { readonly label: string; readonly value: string };
type NodeSummary = {
  readonly kind: 'node' | 'profile' | 'automatic-group' | 'manual-branch';
  readonly label: string;
  readonly counts: readonly CountDetail[];
  readonly notes: readonly string[];
};

export const GROUP_SIZE_EXPLANATION =
  'Triangle size shows a compressed node count, not an exact ratio or isolate count.';
const countText = (value: number | undefined) => (value === undefined ? 'Unavailable' : value.toLocaleString('en-US'));

/** One view model for hover and inspection; never imply that root metadata covers a folded branch. */
export function nodeSummary(attributes?: Readonly<Record<string, unknown>>): NodeSummary {
  const isolates = readNodeIsolateCount(attributes);
  if (attributes?.isBranchCollapsed === true) {
    const hidden = attributes.collapsedBranchCount;
    const known =
      typeof hidden === 'number' && Number.isSafeInteger(hidden) && hidden >= 0 && hidden < Number.MAX_SAFE_INTEGER;
    return {
      kind: 'manual-branch',
      label: 'Manually collapsed branch',
      counts: [
        {
          label: 'Nodes represented',
          value: known ? `${countText(hidden + 1)} (root + ${countText(hidden)} hidden)` : 'Unavailable',
        },
        { label: 'Root node isolates', value: countText(isolates) },
        { label: 'Branch isolate total', value: 'Unavailable in this view' },
      ],
      notes: ['Ancillary data and isolate IDs here describe the root node only.', GROUP_SIZE_EXPLANATION],
    };
  }
  const members = attributes?.memberCount;
  const known = typeof members === 'number' && Number.isSafeInteger(members) && members > 0;
  if (attributes?.isClusterProxy === true || (known && members > 1)) {
    return {
      kind: 'automatic-group',
      label: 'Automatic group (LoD)',
      counts: [
        { label: 'Nodes represented', value: countText(known ? members : undefined) },
        { label: 'Isolates represented', value: countText(isolates) },
      ],
      notes: [GROUP_SIZE_EXPLANATION],
    };
  }
  return {
    kind: isolates !== undefined ? 'profile' : 'node',
    label: isolates !== undefined ? 'Profile' : 'Node',
    counts: [
      { label: 'Nodes represented', value: '1' },
      { label: 'Isolates represented', value: countText(isolates) },
    ],
    notes:
      isolates === undefined ? ['This view does not provide an isolate count; unavailable does not mean zero.'] : [],
  };
}

export function nodeTooltip(nodeId: string, attributes?: Readonly<Record<string, unknown>>): string {
  const summary = nodeSummary(attributes);
  return [
    `${summary.label}: ${nodeId}`,
    ...summary.counts.map(count => `${count.label}: ${count.value}`),
    ...summary.notes,
  ].join('\n');
}
