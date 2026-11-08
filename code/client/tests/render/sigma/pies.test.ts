import { setupSigmaHarness } from './harness';
import { expect, it, vi } from 'vitest';
import { MAX_PIE_SLICE_KEYS, PIE_ATTRIBUTE_PREFIX, PIE_OTHER_SLICE_KEY } from '../../../src/render/mapping/pieMapping';
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

  it('falls back to default nodes if pie-program rebuild fails', () => {
    document.body.innerHTML = `<div id="${'graph-root'}" style="width:300px;height:200px"></div>`;

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {
      return undefined;
    });
    const renderer = harness.createSigmaRenderer();
    renderer.mount({ container: harness.requireContainer() });
    renderer.render({
      nodes: [{ id: 'a', x: 0, y: 0 }],
      edges: [],
      viewMeta: { layout: 'force', lodLevel: 0 },
    });

    harness.shouldThrowOnPieProgram = true;
    expect(() => {
      renderer.render({
        nodes: [
          {
            id: 'a',
            x: 0,
            y: 0,
            attributes: { pie__country__value__canada: 1 },
          },
        ],
        edges: [],
        viewMeta: { layout: 'force', lodLevel: 0 },
      });
    }).not.toThrow();
    expect(harness.sigma().graph?.getNodeAttribute('a', 'type')).toBe('circle');
    expect(warnSpy).toHaveBeenCalledWith(
      'Failed to build Sigma piechart program; falling back to default nodes.',
      expect.objectContaining({
        sliceCount: 1,
        sliceKeys: ['pie__country__value__canada'],
        error: expect.any(Error),
      })
    );

    harness.shouldThrowOnPieProgram = false;
    expect(() =>
      renderer.render({
        nodes: [{ id: 'a', x: 0, y: 0 }],
        edges: [],
        viewMeta: { layout: 'force', lodLevel: 0 },
      })
    ).not.toThrow();

    renderer.unmount();
    warnSpy.mockRestore();
  });

  it('rebuilds pie programs when category colors change', () => {
    document.body.innerHTML = `<div id="${'graph-root'}" style="width:300px;height:200px"></div>`;

    const renderer = harness.createSigmaRenderer();
    renderer.mount({ container: harness.requireContainer() });
    renderer.render({
      nodes: [
        {
          id: 'a',
          x: 0,
          y: 0,
          attributes: {
            pie__country__value__portugal: 1,
            __pie_category_colors: {
              pie__country__value__portugal: '#123456',
            },
          },
        },
      ],
      edges: [],
      viewMeta: { layout: 'force', lodLevel: 0 },
    });
    renderer.render({
      nodes: [
        {
          id: 'a',
          x: 0,
          y: 0,
          attributes: {
            pie__country__value__portugal: 1,
            __pie_category_colors: {
              pie__country__value__portugal: '#abcdef',
            },
          },
        },
      ],
      edges: [],
      viewMeta: { layout: 'force', lodLevel: 0 },
    });

    expect(harness.pieProgramInputs).toHaveLength(2);
    expect(harness.pieProgramInputs[0]?.slices[0]?.color.value).toBe('#123456');
    expect(harness.pieProgramInputs[1]?.slices[0]?.color.value).toBe('#abcdef');

    renderer.unmount();
  });

  it('renders omitted high-cardinality pie values through Others', () => {
    document.body.innerHTML = `<div id="${'graph-root'}" style="width:300px;height:200px"></div>`;

    const renderer = harness.createSigmaRenderer();
    renderer.mount({ container: harness.requireContainer() });
    renderer.render({
      nodes: Array.from({ length: MAX_PIE_SLICE_KEYS + 2 }, (_, index) => ({
        id: `node_${index}`,
        x: index,
        y: index,
        attributes: {
          [`${PIE_ATTRIBUTE_PREFIX}country_${index}`]: index + 1,
        },
      })),
      edges: [],
      viewMeta: { layout: 'force', lodLevel: 0 },
    });

    const latestPieProgram = harness.pieProgramInputs.at(-1);
    expect(latestPieProgram?.slices).toHaveLength(MAX_PIE_SLICE_KEYS);
    expect(latestPieProgram?.slices.map(slice => slice.value.attribute)).toContain(PIE_OTHER_SLICE_KEY);
    expect(harness.sigma().graph?.getNodeAttribute('node_0', PIE_OTHER_SLICE_KEY)).toBe(1);
    expect(harness.sigma().graph?.getNodeAttribute('node_0', 'type')).toBe('piechart');

    renderer.unmount();
  });

  it('keeps node piecharts visible for 24-category PHYLOViZ fields', () => {
    document.body.innerHTML = `<div id="${'graph-root'}" style="width:300px;height:200px"></div>`;

    const categories = Array.from({ length: 24 }, (_, index) => `emm_${index}`);
    const renderer = harness.createSigmaRenderer();
    renderer.mount({ container: harness.requireContainer() });
    renderer.render({
      nodes: categories.map((category, index) => ({
        id: `node_${index}`,
        x: index,
        y: index,
        attributes: {
          [`${PIE_ATTRIBUTE_PREFIX}emm_type__value__${category}`]: index + 1,
        },
      })),
      edges: [],
      viewMeta: { layout: 'force', lodLevel: 0 },
    });

    const latestPieProgram = harness.pieProgramInputs.at(-1);
    expect(latestPieProgram?.slices).toHaveLength(MAX_PIE_SLICE_KEYS);
    expect(latestPieProgram?.slices.map(slice => slice.value.attribute)).toContain(PIE_OTHER_SLICE_KEY);
    expect(harness.sigma().graph?.getNodeAttribute('node_0', 'type')).toBe('piechart');
    expect(harness.sigma().graph?.getNodeAttribute('node_0', PIE_OTHER_SLICE_KEY)).toBe(1);

    renderer.unmount();
  });

  it('reuses one pie update path for render and viewport snapshots', () => {
    const renderer = harness.createSigmaRenderer({ forceMotion: { enabled: false } });
    renderer.mount({ container: harness.requireContainer() });
    const graph = snapshot();
    graph.nodes[0].attributes = { pie__one: 2, __pie_category_colors: { pie__one: '#ff0000' } };
    renderer.render(graph);
    const first = harness.sigmaDoubles.instances.length;
    renderer.applyGraphSnapshot(graph);
    expect(harness.sigmaDoubles.instances.length).toBe(first);
    renderer.applyGraphSnapshot({
      ...graph,
      nodes: [
        { ...graph.nodes[0], attributes: { pie__one: 2, __pie_category_colors: { pie__one: '#00ff00' } } },
        graph.nodes[1],
      ],
    });
    expect(harness.sigmaDoubles.instances.length).toBe(first + 1);
    const plain = snapshot();
    renderer.applyGraphSnapshot(plain);
    expect(harness.sigmaDoubles.instances.length).toBe(first + 2);
    renderer.applyGraphSnapshot(plain);
    expect(harness.sigmaDoubles.instances.length).toBe(first + 2);
    renderer.unmount();
  });

  it('keeps the pie fast path and releases event handlers on teardown', () => {
    const renderer = harness.createSigmaRenderer({ piechart: { enabled: false }, forceMotion: { enabled: false } });
    renderer.mount({ container: harness.requireContainer() });
    renderer.applyGraphSnapshot(snapshot());
    const graph = harness.sigma().graph!;
    const materialize = vi.spyOn(graph, 'mapNodes');
    renderer.applyGraphSnapshot(snapshot());
    expect(materialize).not.toHaveBeenCalled();
    const notify = vi.fn();
    renderer.setNodeClickHandler(notify);
    harness.sigma().handler('clickNode')?.({ event: { node: 'a' } });
    expect(notify).toHaveBeenCalledTimes(1);
    renderer.unmount();
    expect(harness.sigma().handler('clickNode')).toBeNull();
    expect(harness.sigma().handler('doubleClickNode')).toBeNull();
    expect(harness.sigma().camera.handler('updated')).toBeNull();
  });

  it('retains the pie-program failure fallback', () => {
    const renderer = harness.createSigmaRenderer({ forceMotion: { enabled: false } });
    renderer.mount({ container: harness.requireContainer() });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    harness.shouldThrowOnPieProgram = true;
    const graph = snapshot();
    graph.nodes[0].attributes = { pie__one: 2 };
    renderer.applyGraphSnapshot(graph);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(harness.sigma().graph?.getNodeAttribute('a', 'type')).not.toBe('piechart');
    renderer.unmount();
  });
});
