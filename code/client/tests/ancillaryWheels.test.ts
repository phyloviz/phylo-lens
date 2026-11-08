import { describe, expect, it, vi } from 'vitest';
import ancillaryWheels from '../src/app/shell/ancillary/ancillaryWheels';
import type { PositionedGraph } from '../src/contracts/positioned';

function fixture() {
  let graph: PositionedGraph = {
    nodes: [
      {
        id: 'profile',
        x: 0,
        y: 0,
        attributes: {
          memberCount: 1,
          metadata: {
            profile_count: 2,
            country: 'Portugal;Spain',
            __category_count__country__value__Portugal: 1,
            __category_count__country__value__Spain: 1,
          },
          isolates: [
            { id: 'Original A', ancillaryData: { country: 'Portugal' } },
            { id: '<b>Original B</b>', ancillaryData: { country: 'Spain' } },
          ],
        },
      },
    ],
    edges: [],
    viewMeta: { layout: 'server', lodLevel: 0 },
  };
  let fields: string[] = [];
  const overview = document.createElement('div');
  const selected = document.createElement('div');
  const wheels = ancillaryWheels({
    overviewContainer: overview,
    selectedNodeContainer: selected,
    getGraph: () => graph,
    getSelectedFields: () => fields,
    getVisualMapping: () => ({}),
    getCategoryColorOverrides: () => ({}),
    selectPieFieldMessage: 'Choose a field',
    selectedNodeEmptyMessage: 'Choose a node',
  });
  return {
    wheels,
    overview,
    selected,
    setFields: (next: string[]) => {
      fields = next;
    },
    setGraph: (next: PositionedGraph) => {
      graph = next;
    },
  };
}

describe('ancillary node inspection', () => {
  it('uses the same field selection for the chart and its heading', () => {
    const overview = document.createElement('div');
    const wheels = ancillaryWheels({
      overviewContainer: overview,
      getGraph: () => ({
        nodes: [{ id: 'a', x: 0, y: 0, attributes: { metadata: { country: 'Portugal' } } }],
        edges: [],
        viewMeta: { layout: 'server', lodLevel: 0 },
      }),
      getSelectedFields: vi.fn<() => readonly string[]>().mockReturnValueOnce(['country']).mockReturnValue([]),
      getVisualMapping: () => ({}),
      getCategoryColorOverrides: () => ({}),
      selectPieFieldMessage: 'Choose a field',
      selectedNodeEmptyMessage: 'Choose a node',
    });
    wheels.renderOverview();
    expect(overview.textContent).toContain('Color field: country');
    expect(overview.querySelector('.wheel-chart')).not.toBeNull();
    expect(overview.textContent).toContain('Portugal');
  });

  it('shows original IDs and counts without metadata coloring, treating IDs as text', () => {
    const { wheels, selected } = fixture();
    wheels.renderSelectedNode('profile');
    expect(selected.textContent).toContain('Profile: profile');
    expect([...selected.querySelectorAll('.node-counts dd')].map(value => value.textContent)).toEqual(['1', '2']);
    const details = selected.querySelector('details')!;
    expect(details.querySelectorAll('li')).toHaveLength(0);
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
    expect([...selected.querySelectorAll('li')].map(item => item.textContent)).toEqual([
      'Original A',
      '<b>Original B</b>',
    ]);
    expect(selected.querySelector('b')).toBeNull();
    expect(selected.textContent).toContain('Ancillary coloring: none');

    details.open = false;
    details.dispatchEvent(new Event('toggle'));
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
    expect(details.querySelectorAll('li')).toHaveLength(2);
  });

  it('keeps the selected profile and displays the active field and per-isolate distribution', () => {
    const { wheels, selected, overview, setFields } = fixture();
    wheels.renderSelectedNode('profile');
    const details = selected.querySelector('details');
    if (details) {
      details.open = true;
      details.dispatchEvent(new Event('toggle'));
    }
    setFields(['country']);
    wheels.refreshSelectedNode();
    wheels.renderOverview();
    expect(selected.textContent).toContain('Profile: profile');
    expect(selected.textContent).toContain('Color field: country');
    expect(selected.querySelector('details')?.open).toBe(true);
    expect(selected.querySelectorAll('.wheel-meta li')).toHaveLength(2);
    expect(selected.textContent?.match(/50.0%/g)).toHaveLength(2);
    expect(overview.textContent).toContain('Current view · Color field: country');
    setFields([]);
    wheels.refreshSelectedNode();
    expect(selected.querySelector('.wheel-chart')).toBeNull();
    expect([...selected.querySelectorAll('.node-counts dd')].map(value => value.textContent)).toEqual(['1', '2']);
    wheels.resetSelectedNode();
    wheels.refreshSelectedNode();
    expect(selected.textContent).toBe('Choose a node');
  });

  it('does not leave stale details when the selected node leaves the viewport', () => {
    const { wheels, selected, setGraph } = fixture();
    wheels.renderSelectedNode('profile');
    setGraph({ nodes: [], edges: [], viewMeta: { layout: 'server', lodLevel: 0 } });
    wheels.refreshSelectedNode();
    expect(selected.textContent).toContain('outside the current view');
    expect(selected.textContent).not.toContain('Original A');
  });

  it('distinguishes a LoD cluster from a biological profile', () => {
    const { wheels, selected, setGraph } = fixture();
    setGraph({
      nodes: [
        {
          id: 'cluster',
          x: 0,
          y: 0,
          attributes: { memberCount: 3, metadata: { profile_count: 7 }, isolates: [] },
        },
      ],
      edges: [],
      viewMeta: { layout: 'server', lodLevel: 1 },
    });
    wheels.renderSelectedNode('cluster');
    expect(selected.textContent).toContain('Automatic group (LoD): cluster');
    expect([...selected.querySelectorAll('.node-counts dt')].map(value => value.textContent)).toEqual([
      'Nodes represented',
      'Isolates represented',
    ]);
    expect([...selected.querySelectorAll('.node-counts dd')].map(value => value.textContent)).toEqual(['3', '7']);
    expect(selected.querySelector('details')).toBeNull();
  });

  it('scopes manual-fold isolates, IDs and pies to the root rather than inventing a branch total', () => {
    const { wheels, selected, setGraph, setFields } = fixture();
    setGraph({
      nodes: [
        {
          id: 'root',
          x: 0,
          y: 0,
          attributes: {
            isBranchCollapsed: true,
            collapsedBranchCount: 40,
            memberCount: 1,
            metadata: { profile_count: 2, country: 'Portugal' },
            isolates: [
              { id: 'root-A', ancillaryData: { country: 'Portugal' } },
              { id: 'root-B', ancillaryData: { country: 'Portugal' } },
            ],
          },
        },
      ],
      edges: [],
      viewMeta: { layout: 'server', lodLevel: 0 },
    });
    setFields(['country']);
    wheels.renderSelectedNode('root');
    expect([...selected.querySelectorAll('.node-counts dd')].map(value => value.textContent)).toEqual([
      '41 (root + 40 hidden)',
      '2',
      'Unavailable in this view',
    ]);
    expect(selected.textContent).toContain('Root node isolate IDs (2)');
    expect(selected.textContent).toContain("Root node 'root' only");
    expect(selected.textContent).toContain('Ancillary data and isolate IDs here describe the root node only.');
  });
});
