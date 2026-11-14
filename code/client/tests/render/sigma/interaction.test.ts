import { setupSigmaHarness } from './harness';
import { expect, it, vi } from 'vitest';
import { PHYLOVIZ_NODE_SELECTED_COLOR } from '../../../src/render/adapters/sigma/sigmaRendering.constants';
import type { GraphNodeAttributes } from '../../../src/contracts/positioned';

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

  it('emits separate node click and double-click callbacks', () => {
    document.body.innerHTML = `<div id="${'graph-root'}" style="width:300px;height:200px"></div>`;

    const renderer = harness.createSigmaRenderer();
    const clickHandler = vi.fn();
    const doubleClickHandler = vi.fn();
    renderer.mount({ container: harness.requireContainer() });
    renderer.render({
      nodes: [{ id: 'cluster-a', x: 0, y: 0, attributes: { clusterId: 'cluster-a' } }],
      edges: [],
      viewMeta: { layout: 'server', lodLevel: 0 },
    });
    renderer.setNodeClickHandler(clickHandler);
    renderer.setNodeDoubleClickHandler(doubleClickHandler);

    harness.sigma().handler('clickNode')?.({ node: 'cluster-a' });
    harness.sigma().handler('doubleClickNode')?.({ node: 'cluster-a' });

    expect(clickHandler).toHaveBeenCalledWith({
      nodeId: 'cluster-a',
      attributes: expect.objectContaining({ clusterId: 'cluster-a' }),
    });
    expect(doubleClickHandler).toHaveBeenCalledWith({
      nodeId: 'cluster-a',
      attributes: expect.objectContaining({ clusterId: 'cluster-a' }),
    });

    renderer.unmount();
  });

  it('dims non-highlighted nodes/edges via reducers and clears them', () => {
    document.body.innerHTML = `<div id="${'graph-root'}" style="width:300px;height:200px"></div>`;

    const renderer = harness.createSigmaRenderer();
    renderer.mount({ container: harness.requireContainer() });
    renderer.render({
      nodes: [
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: 10, y: 10 },
        { id: 'c', x: 20, y: 20 },
      ],
      edges: [
        { id: 'e_a_b', source: 'a', target: 'b' },
        { id: 'e_b_c', source: 'b', target: 'c' },
      ],
      viewMeta: { layout: 'server', lodLevel: 0 },
    });

    renderer.setHighlightedNodes(new Set(['a', 'b']));

    const nodeReducer = harness.sigma().settings?.nodeReducer as
      ((id: string, data: Record<string, unknown>) => Record<string, unknown>) | undefined;
    const edgeReducer = harness.sigma().settings?.edgeReducer as
      ((id: string, data: Record<string, unknown>) => Record<string, unknown>) | undefined;
    expect(typeof nodeReducer).toBe('function');
    // Highlighted node is untouched; outside node is dimmed and delabeled.
    expect(nodeReducer?.('a', { color: '#111', label: 'a' })).toMatchObject({
      color: '#111',
      label: 'a',
    });
    expect(nodeReducer?.('c', { color: '#111', label: 'c' })).toMatchObject({
      color: '#cbd5e1',
      label: '',
    });
    // Internal edge stays; boundary edge (b-c) is dimmed.
    expect(edgeReducer?.('e_a_b', { color: '#111' })).toMatchObject({
      color: '#111',
    });
    expect(edgeReducer?.('e_b_c', { color: '#111' })).toMatchObject({
      color: '#e2e8f0',
    });

    // Clearing removes the reducers.
    renderer.setHighlightedNodes(null);
    expect(harness.sigma().settings?.nodeReducer).toBeNull();
    expect(harness.sigma().settings?.edgeReducer).toBeNull();

    renderer.unmount();
  });

  it('shows exact scoped hover counts, refreshes them across snapshots and clears stale tooltips', () => {
    const container = harness.requireContainer();
    const renderer = harness.createSigmaRenderer();
    renderer.mount({ container });
    const snapshot = {
      nodes: [
        {
          id: 'group',
          x: 0,
          y: 0,
          size: 8,
          attributes: { isClusterProxy: true, memberCount: 3, metadata: { profile_count: 7 } },
        },
      ],
      edges: [],
      viewMeta: { layout: 'server' as const, lodLevel: 0 },
    };
    renderer.render(snapshot);
    harness.sigma().handler('enterNode')?.({ node: 'group' });
    expect(container.title).toContain('Automatic group (LoD): group');
    expect(container.title).toContain('Nodes represented: 3');
    expect(container.title).toContain('Isolates represented: 7');
    renderer.applyGraphSnapshot({
      ...snapshot,
      nodes: [
        {
          id: 'group',
          x: 0,
          y: 0,
          size: 8,
          attributes: { isBranchCollapsed: true, collapsedBranchCount: 99, metadata: { profile_count: 2 } },
        },
      ],
    });
    expect(container.title).toContain('Nodes represented: 100 (root + 99 hidden)');
    expect(container.title).toContain('Root node isolates: 2');
    expect(container.title).toContain('Branch isolate total: Unavailable');
    harness.sigma().handler('leaveNode')?.({ node: 'group' });
    expect(container.hasAttribute('title')).toBe(false);
    harness.sigma().handler('enterNode')?.({ node: 'group' });
    renderer.applyGraphSnapshot({ ...snapshot, nodes: [] });
    expect(container.hasAttribute('title')).toBe(false);
    renderer.unmount();
    expect(harness.sigma().handler('enterNode')).toBeNull();
    expect(harness.sigma().handler('leaveNode')).toBeNull();
  });

  it('marks focused search nodes as PHYLOViZ selected nodes', () => {
    document.body.innerHTML = `<div id="${'graph-root'}" style="width:300px;height:200px"></div>`;

    const renderer = harness.createSigmaRenderer({
      display: {
        nodeLabels: false,
      },
    });
    renderer.mount({ container: harness.requireContainer() });
    renderer.render({
      nodes: [
        { id: 'target', x: 0, y: 0, size: 6 },
        { id: 'nearby', x: 2, y: 1, size: 6 },
      ],
      edges: [],
      viewMeta: { layout: 'force', lodLevel: 0 },
    });

    renderer.focusNode('target');

    const nodeReducer = harness.sigma().settings?.nodeReducer as
      ((id: string, data: Record<string, unknown>) => Record<string, unknown>) | undefined;
    const renderedTarget = nodeReducer?.('target', {
      type: harness.sigma().graph?.getNodeAttribute('target', 'type'),
      color: harness.sigma().graph?.getNodeAttribute('target', 'color'),
      borderColor: harness.sigma().graph?.getNodeAttribute('target', 'borderColor'),
      label: harness.sigma().graph?.getNodeAttribute('target', 'label'),
      size: harness.sigma().graph?.getNodeAttribute('target', 'size'),
    });

    expect(harness.sigma().graph?.getNodeAttribute('target', 'type')).toBe('circle');
    expect(harness.sigma().graph?.getNodeAttribute('target', 'color')).toBe('#93c5fd');
    expect(renderedTarget).toMatchObject({
      type: 'border',
      color: '#dc2626',
      borderColor: '#ffffff',
      forceLabel: true,
      label: 'target',
    });
    expect(renderedTarget?.size).toBeGreaterThan(6);
    expect(harness.sigma().graph?.getNodeAttribute('nearby', 'type')).toBe('circle');

    renderer.unmount();
  });

  it('clears focused node selection when the canvas background is clicked', () => {
    document.body.innerHTML = `<div id="${'graph-root'}" style="width:300px;height:200px"></div>`;

    const renderer = harness.createSigmaRenderer();
    const nodeClickHandler = vi.fn();
    renderer.mount({ container: harness.requireContainer() });
    renderer.setNodeClickHandler(nodeClickHandler);
    renderer.render({
      nodes: [
        { id: 'target', x: 0, y: 0, size: 6 },
        { id: 'nearby', x: 2, y: 1, size: 6 },
      ],
      edges: [],
      viewMeta: { layout: 'force', lodLevel: 0 },
    });

    renderer.focusNode('target');
    expect(harness.sigma().settings?.nodeReducer).toEqual(expect.any(Function));

    harness.sigma().handler('clickStage')?.({});

    expect(harness.sigma().settings?.nodeReducer).toBeNull();
    expect(nodeClickHandler).toHaveBeenCalledWith({ nodeId: null });

    renderer.unmount();
  });

  it('toggles and restores node selection styling in-place in viewport sync mode', () => {
    document.body.innerHTML = `<div id="${'graph-root'}" style="width:300px;height:200px"></div>`;

    const renderer = harness.createSigmaRenderer();
    renderer.mount({ container: harness.requireContainer() });
    renderer.applyGraphSnapshot({
      nodes: [
        { id: 'node_1', x: 10, y: 20, size: 5, color: '#93c5fd', attributes: { color: '#93c5fd', size: 5 } },
        { id: 'node_2', x: 30, y: 40, size: 5, color: '#93c5fd', attributes: { color: '#93c5fd', size: 5 } },
      ],
      edges: [],
      viewMeta: { layout: 'server', lodLevel: 0 },
    });

    const graph = harness.sigma().graph!;

    // Nodes keep their base graphology attributes; selection is a render reducer.
    expect(graph.getNodeAttribute('node_1', 'unselectedStyle')).toBeUndefined();
    expect(graph.getNodeAttribute('node_1', 'type')).toBeUndefined();
    expect(graph.getNodeAttribute('node_1', 'color')).toBe('#93c5fd');

    renderer.focusNode('node_1');
    const selectedNodeReducer = harness.sigma().settings?.nodeReducer as
      ((id: string, data: Record<string, unknown>) => Record<string, unknown>) | undefined;
    expect(selectedNodeReducer?.('node_1', graph.getNodeAttributes('node_1'))).toMatchObject({
      type: 'border',
      color: PHYLOVIZ_NODE_SELECTED_COLOR,
      borderColor: '#ffffff',
      forceLabel: true,
    });
    expect(graph.getNodeAttribute('node_1', 'type')).toBeUndefined();
    expect(graph.getNodeAttribute('node_1', 'color')).toBe('#93c5fd');

    renderer.focusNode('node_2');
    const nextNodeReducer = harness.sigma().settings?.nodeReducer as
      ((id: string, data: Record<string, unknown>) => Record<string, unknown>) | undefined;
    expect(nextNodeReducer?.('node_2', graph.getNodeAttributes('node_2'))).toMatchObject({
      type: 'border',
      color: PHYLOVIZ_NODE_SELECTED_COLOR,
    });
    expect(graph.getNodeAttribute('node_1', 'type')).toBeUndefined();
    expect(graph.getNodeAttribute('node_2', 'type')).toBeUndefined();

    renderer.focusNode(null);
    expect(harness.sigma().settings?.nodeReducer).toBeNull();
    expect(graph.getNodeAttribute('node_2', 'type')).toBeUndefined();

    renderer.unmount();
  });

  it('owns highlight sets instead of observing edits to the supplied set', () => {
    const renderer = harness.createSigmaRenderer({ forceMotion: { enabled: false } });
    renderer.mount({ container: harness.requireContainer() });
    renderer.applyGraphSnapshot(snapshot());
    const selected = new Set(['a']);
    renderer.setHighlightedNodes(selected);
    selected.clear();
    selected.add('b');
    const reducer = harness.sigma().settings?.nodeReducer as (
      id: string,
      attrs: { color: string }
    ) => { color: string };
    expect(reducer('a', { color: '#123456' }).color).toBe('#123456');
    expect(reducer('b', { color: '#123456' }).color).not.toBe('#123456');
    renderer.unmount();
  });
});
