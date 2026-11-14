import { setupSigmaHarness } from './harness';
import { expect, it } from 'vitest';
import type { GraphNodeAttributes } from '../../../src/contracts/positioned';
import { freezeInput } from '../../helpers/state';

const harness = setupSigmaHarness();

describe('sigmaRenderer', () => {
  const snapshot = (attributes: GraphNodeAttributes = {}) => ({
    nodes: [
      { id: 'a', x: 0, y: 0, size: 3, color: '#123456', attributes },
      { id: 'b', x: 10, y: 0, size: 3, color: '#123456' },
    ],
    edges: [{ id: 'ab', source: 'a', target: 'b', attributes: { size: 1, color: '#123456', distance: 4, label: '' } }],
    viewMeta: { layout: 'server' as const, lodLevel: 0 },
  });

  it('registers node programs for selected nodes and expandable cluster proxies', () => {
    document.body.innerHTML = `<div id="${'graph-root'}" style="width:300px;height:200px"></div>`;

    const renderer = harness.createSigmaRenderer();
    renderer.mount({ container: harness.requireContainer() });

    const nodeProgramClasses = harness.sigma().settings?.['nodeProgramClasses'] as Record<string, unknown> | undefined;

    expect(nodeProgramClasses).toBeDefined();
    expect(nodeProgramClasses?.['border']).toBeDefined();
    expect(nodeProgramClasses?.['triangle']).toBeDefined();

    renderer.unmount();
  });

  it('points cluster proxy triangle tips at their incident tree edges', () => {
    document.body.innerHTML = `<div id="${'graph-root'}" style="width:300px;height:200px"></div>`;

    const renderer = harness.createSigmaRenderer();
    renderer.mount({ container: harness.requireContainer() });
    renderer.render({
      nodes: [
        { id: 'root', x: 0, y: 0 },
        {
          id: 'cluster',
          x: 0,
          y: 10,
          attributes: { isClusterProxy: true },
        },
      ],
      edges: [{ id: 'root-cluster', source: 'root', target: 'cluster' }],
      viewMeta: { layout: 'server', lodLevel: 0 },
    });

    expect(harness.sigma().graph?.getNodeAttribute('cluster', 'type')).toBe('triangle');
    expect(harness.sigma().graph?.getNodeAttribute('cluster', 'triangleRotation')).toBeCloseTo(-Math.PI / 2);

    renderer.unmount();
  });

  it('keeps summary markers visible and distinct when their roots are structural junctions', () => {
    const renderer = harness.createSigmaRenderer();
    renderer.mount({ container: harness.requireContainer() });
    const snapshot = {
      nodes: [
        { id: 'union_1', x: 0, y: 0, size: 0, color: '#ffffff' },
        {
          id: 'union_2',
          x: 10,
          y: 0,
          size: 9,
          attributes: { isClusterProxy: true, memberCount: 37, type: 'triangle' },
        },
        { id: 'union_3', x: 0, y: 10, size: 8, attributes: { isBranchCollapsed: true, type: 'triangle' } },
      ],
      edges: [],
      viewMeta: { layout: 'server' as const, lodLevel: 0 },
    };
    renderer.render(snapshot);
    const check = () => {
      expect(harness.sigma().graph?.getNodeAttributes('union_1')).toMatchObject({ size: 0, color: '#ffffff' });
      expect(harness.sigma().graph?.getNodeAttributes('union_2')).toMatchObject({
        size: 9,
        color: '#f59e0b',
        type: 'triangle',
      });
      expect(harness.sigma().graph?.getNodeAttributes('union_3')).toMatchObject({
        size: 8,
        color: '#7c3aed',
        type: 'triangle',
      });
    };
    check();
    renderer.applyGraphSnapshot(snapshot);
    check();
    renderer.unmount();
  });

  it('renders manual folds as violet triangles without treating them as LoD aggregates', () => {
    document.body.innerHTML = `<div id="${'graph-root'}" style="width:300px;height:200px"></div>`;
    const renderer = harness.createSigmaRenderer();
    renderer.mount({ container: harness.requireContainer() });
    renderer.render({
      nodes: [
        { id: 'root', x: 0, y: 0 },
        { id: 'fold', x: 0, y: 10, attributes: { isBranchCollapsed: true, type: 'triangle' } },
        { id: 'group', x: 10, y: 0, attributes: { isClusterProxy: true, memberCount: 5 } },
      ],
      edges: [{ id: 'root-fold', source: 'root', target: 'fold' }],
      viewMeta: { layout: 'server', lodLevel: 0 },
    });
    expect(harness.sigma().graph?.getNodeAttribute('fold', 'type')).toBe('triangle');
    expect(harness.sigma().graph?.getNodeAttribute('fold', 'color')).toBe('#7c3aed');
    expect(harness.sigma().graph?.getNodeAttribute('group', 'color')).toBe('#f59e0b');
    expect(harness.sigma().graph?.getNodeAttribute('fold', 'triangleRotation')).toBeCloseTo(-Math.PI / 2);
    expect(renderer.getInteractiveAggregateTargets().map(target => target.clusterId)).toEqual(['group']);
    renderer.focusNode('fold');
    const reducer = harness.sigma().settings?.nodeReducer as
      ((id: string, data: Record<string, unknown>) => Record<string, unknown>) | undefined;
    expect(reducer?.('fold', harness.sigma().graph!.getNodeAttributes('fold')).type).toBe('triangle');
    expect(reducer?.('fold', harness.sigma().graph!.getNodeAttributes('fold')).color).toBe('#7c3aed');
    renderer.focusNode(null);
    expect(harness.sigma().graph?.getNodeAttribute('fold', 'color')).toBe('#7c3aed');
    renderer.unmount();
  });

  it('uses centered node labels and hides implementation-only node ids', () => {
    document.body.innerHTML = `<div id="${'graph-root'}" style="width:300px;height:200px"></div>`;

    const renderer = harness.createSigmaRenderer();
    renderer.mount({ container: harness.requireContainer() });
    renderer.render({
      nodes: [
        { id: 'union_1', x: 0, y: 0 },
        // A real isolate whose label merely starts with the union prefix
        // must NOT be hidden — only generated `union_<digits>` ids are.
        { id: 'union_sample', x: 0.75, y: 0.75 },
        // `internal_` is not a structural convention the server emits, so an
        // `internal_`-prefixed id is a real node and must render normally.
        { id: 'internal_7', x: 0.5, y: 0.5 },
        { id: 'profile_1', x: 1, y: 1 },
        {
          id: 'cluster_proxy:lod_4_42',
          x: 2,
          y: 2,
          attributes: {
            clusterId: 'lod_4_42',
            isClusterProxy: true,
          },
        },
      ],
      edges: [],
      viewMeta: { layout: 'force', lodLevel: 0 },
    });

    expect(harness.sigma().settings?.defaultDrawNodeLabel).toBeTypeOf('function');
    expect(harness.sigma().graph?.getNodeAttribute('union_1', 'label')).toBe('');
    expect(harness.sigma().graph?.getNodeAttribute('union_1', 'size')).toBe(0);
    expect(harness.sigma().graph?.getNodeAttribute('union_1', 'color')).toBe('#ffffff');
    expect(harness.sigma().graph?.getNodeAttribute('union_sample', 'label')).toBe('union_sample');
    expect(harness.sigma().graph?.getNodeAttribute('union_sample', 'size')).not.toBe(0);
    expect(harness.sigma().graph?.getNodeAttribute('internal_7', 'label')).toBe('internal_7');
    expect(harness.sigma().graph?.getNodeAttribute('internal_7', 'size')).not.toBe(0);
    expect(harness.sigma().graph?.getNodeAttribute('profile_1', 'label')).toBe('profile_1');
    expect(harness.sigma().graph?.getNodeAttribute('cluster_proxy:lod_4_42', 'label')).toBe('');

    renderer.unmount();
  });

  it('renders edge distance labels and distance-weighted grayscale at constant width', () => {
    document.body.innerHTML = `<div id="${'graph-root'}" style="width:300px;height:200px"></div>`;

    const renderer = harness.createSigmaRenderer({
      display: {
        edgeDistanceLabels: true,
        distanceWeightedEdges: true,
      },
    });
    renderer.mount({ container: harness.requireContainer() });
    renderer.render({
      nodes: [
        { id: 'root', x: 0, y: 0 },
        { id: 'a', x: 80, y: 100 },
      ],
      edges: [
        {
          id: 'e_root_a_1',
          source: 'root',
          target: 'a',
          attributes: { distance: 2.5 },
        },
      ],
      viewMeta: { layout: 'force', lodLevel: 0 },
    });

    expect(harness.sigma().settings?.renderEdgeLabels).toBe(false);
    expect(harness.sigma().graph?.getEdgeAttribute('e_root_a_1', 'label')).toBe('2.500');
    expect(harness.sigma().graph?.getEdgeAttribute('e_root_a_1', 'forceLabel')).toBe(true);
    expect(harness.sigma().graph?.getEdgeAttribute('e_root_a_1', 'size')).toBe(1.75);
    expect(harness.sigma().graph?.getEdgeAttribute('e_root_a_1', 'color')).toBe('#787878');

    harness.sigma().camera?.setState({ ratio: 0.4 });
    harness.sigma().camera.emit('updated', undefined);
    expect(harness.sigma().settings?.renderEdgeLabels).toBe(true);

    harness.sigma().camera?.setState({ ratio: 1 });
    harness.sigma().camera.emit('updated', undefined);
    expect(harness.sigma().settings?.renderEdgeLabels).toBe(false);

    renderer.unmount();
  });

  it('updates display options without remounting the workbench', () => {
    document.body.innerHTML = `<div id="${'graph-root'}" style="width:300px;height:200px"></div>`;

    const renderer = harness.createSigmaRenderer();
    renderer.mount({ container: harness.requireContainer() });
    renderer.render({
      nodes: [
        { id: 'root', x: 0, y: 0 },
        { id: 'a', x: 80, y: 100 },
      ],
      edges: [
        {
          id: 'e_root_a_1',
          source: 'root',
          target: 'a',
          attributes: { distance: 3 },
        },
      ],
      viewMeta: { layout: 'force', lodLevel: 0 },
    });

    renderer.updateDisplayOptions({
      edgeDistanceLabels: true,
      distanceWeightedEdges: true,
    });
    renderer.render({
      nodes: [
        { id: 'root', x: 0, y: 0 },
        { id: 'a', x: 80, y: 100 },
      ],
      edges: [
        {
          id: 'e_root_a_1',
          source: 'root',
          target: 'a',
          attributes: { distance: 3 },
        },
      ],
      viewMeta: { layout: 'force', lodLevel: 0 },
    });

    expect(harness.sigma().settings?.renderEdgeLabels).toBe(false);
    expect(harness.sigma().graph?.getEdgeAttribute('e_root_a_1', 'label')).toBe('3');

    renderer.unmount();
  });

  it('applies PHYLOViZ node and goeBURST edge color conventions', () => {
    document.body.innerHTML = `<div id="${'graph-root'}" style="width:300px;height:200px"></div>`;

    const renderer = harness.createSigmaRenderer();
    renderer.mount({ container: harness.requireContainer() });
    renderer.render({
      nodes: [
        {
          id: 'founder',
          x: 0,
          y: 0,
          attributes: { metadata: { st_role: 'group founder' } },
        },
        {
          id: 'subfounder',
          x: 80,
          y: 100,
          attributes: { subgroup_founder: true },
        },
        { id: 'common', x: 160, y: 100 },
        { id: 'selected', x: 240, y: 100, attributes: { selected: true } },
      ],
      edges: [
        {
          id: 'rule_1',
          source: 'founder',
          target: 'subfounder',
          attributes: { tie_break_rule: 1 },
        },
        {
          id: 'rule_3',
          source: 'subfounder',
          target: 'common',
          attributes: { tiebreak_rule: 'rule 3' },
        },
        {
          id: 'tlv',
          source: 'common',
          target: 'selected',
          attributes: { level: 'TLV' },
        },
      ],
      viewMeta: { layout: 'force', lodLevel: 0 },
    });

    expect(harness.sigma().graph?.getNodeAttribute('founder', 'color')).toBe('#86efac');
    expect(harness.sigma().graph?.getNodeAttribute('subfounder', 'color')).toBe('#15803d');
    expect(harness.sigma().graph?.getNodeAttribute('common', 'color')).toBe('#93c5fd');
    expect(harness.sigma().graph?.getNodeAttribute('selected', 'color')).toBe('#dc2626');
    expect(harness.sigma().graph?.getEdgeAttribute('rule_1', 'color')).toBe('#2563eb');
    expect(harness.sigma().graph?.getEdgeAttribute('rule_3', 'color')).toBe('#dc2626');
    expect(harness.sigma().graph?.getEdgeAttribute('tlv', 'color')).toBe('#9ca3af');

    renderer.unmount();
  });

  it('uses darker Full MST grayscale links for lower distances', () => {
    document.body.innerHTML = `<div id="${'graph-root'}" style="width:300px;height:200px"></div>`;

    const renderer = harness.createSigmaRenderer();
    renderer.mount({ container: harness.requireContainer() });
    renderer.render({
      nodes: [
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: 80, y: 0 },
        { id: 'c', x: 160, y: 0 },
      ],
      edges: [
        {
          id: 'near',
          source: 'a',
          target: 'b',
          attributes: { distance: 1 },
        },
        {
          id: 'far',
          source: 'b',
          target: 'c',
          attributes: { distance: 5 },
        },
      ],
      viewMeta: { layout: 'force', lodLevel: 0 },
    });

    expect(harness.sigma().graph?.getEdgeAttribute('near', 'color')).toBe('#232323');
    expect(harness.sigma().graph?.getEdgeAttribute('far', 'color')).toBe('#969696');

    renderer.unmount();
  });

  it('preserves the different styling rules for initial rendering and prepared snapshots', () => {
    const input = freezeInput({
      nodes: [
        {
          id: 'a',
          x: 5,
          y: 6,
          size: 8,
          color: '#123456',
          attributes: { x: 900, y: 901, size: 77, color: '#abcdef', phyloviz_role: 'group_founder', label: ' sample ' },
        },
        { id: 'b', x: 10, y: 0 },
      ],
      edges: [
        {
          id: 'ab',
          source: 'a',
          target: 'b',
          attributes: { distance: 4, size: 7, color: '#112233', label: ' prepared edge ', forceLabel: false },
        },
        { id: 'outside', source: 'b', target: 'missing', attributes: { distance: 8 } },
      ],
      viewMeta: { layout: 'server' as const, lodLevel: 0 },
    });
    const renderer = harness.createSigmaRenderer({
      forceMotion: { enabled: false },
      edge: { size: 2 },
      display: { edgeDistanceLabels: true },
    });
    renderer.mount({ container: harness.requireContainer() });
    renderer.render(input);
    expect(harness.sigma().graph?.getNodeAttributes('a')).toMatchObject({
      x: 900,
      y: 901,
      size: 77,
      color: '#86efac',
      label: 'sample',
    });
    expect(harness.sigma().graph?.getEdgeAttributes('ab')).toMatchObject({
      size: 2,
      color: '#232323',
      label: '4',
      forceLabel: true,
    });
    expect(harness.sigma().graph?.edges()).toEqual(['ab']);

    renderer.applyGraphSnapshot(input);
    expect(harness.sigma().graph?.getNodeAttributes('a')).toMatchObject({
      x: 5,
      y: 6,
      size: 8,
      color: '#123456',
      label: ' sample ',
    });
    expect(harness.sigma().graph?.getEdgeAttributes('ab')).toMatchObject({
      size: 7,
      color: '#112233',
      label: ' prepared edge ',
      forceLabel: false,
    });
    expect(harness.sigma().graph?.edges()).toEqual(['ab']);
    renderer.unmount();
  });

  it.each(['render', 'applyGraphSnapshot'] as const)(
    '%s owns edge attributes independently from Graphology updates',
    operation => {
      const renderer = harness.createSigmaRenderer({ forceMotion: { enabled: false } });
      renderer.mount({ container: harness.requireContainer() });
      const graph = snapshot();
      Object.freeze(graph.edges[0].attributes);
      renderer[operation](graph);
      harness.sigma().graph!.setEdgeAttribute('ab', 'label', '4');
      expect(graph.edges[0].attributes.label).toBe('');
      expect(harness.sigma().graph?.getEdgeAttribute('ab', 'label')).toBe('4');
      renderer.unmount();
    }
  );
});
