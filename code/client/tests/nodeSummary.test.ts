import { describe, expect, it } from 'vitest';
import { nodeSummary, nodeTooltip } from '../src/components/node-summary/nodeSummary';

describe('representation count semantics', () => {
  it('keeps node and isolate counts distinct for an automatic group', () => {
    const summary = nodeSummary({ isClusterProxy: true, memberCount: 3, metadata: { profile_count: 7 } });
    expect(summary.kind).toBe('automatic-group');
    expect(summary.counts.map(count => [count.label, count.value])).toEqual([
      ['Nodes represented', '3'],
      ['Isolates represented', '7'],
    ]);
    expect(summary.notes.join(' ')).toContain('not an exact ratio or isolate count');
  });

  it('includes the retained root in a manual node count while keeping its isolates explicitly scoped', () => {
    const text = nodeTooltip('branch', {
      isBranchCollapsed: true,
      collapsedBranchCount: 99,
      metadata: { profile_count: 2 },
    });
    expect(text).toContain('Nodes represented: 100 (root + 99 hidden)');
    expect(text).toContain('Root node isolates: 2');
    expect(text).toContain('Branch isolate total: Unavailable in this view');
    expect(text).not.toContain('Isolates represented: 2');
  });

  it('does not equate unknown isolate membership with zero or ancillary observation counts', () => {
    const summary = nodeSummary({
      memberCount: 10,
      ancillaryDistribution: [{ count: 10, values: { country: 'Portugal' } }],
    });
    expect(summary.counts[1].value).toBe('Unavailable');
    expect(nodeSummary().counts[1].value).toBe('Unavailable');
  });

  it('retains an explicit known zero separately from an unavailable count', () => {
    const summary = nodeSummary({
      annotations: {
        ancillaryData: {},
        ancillarySummary: { values: {}, categoryCounts: {} },
        profileSummary: { isolateCount: 0 },
      },
    });
    expect(summary.counts[1].value).toBe('0');
  });

  it('does not invent group membership when a host omits the count', () => {
    expect(nodeSummary({ isClusterProxy: true }).counts[0].value).toBe('Unavailable');
  });
});
