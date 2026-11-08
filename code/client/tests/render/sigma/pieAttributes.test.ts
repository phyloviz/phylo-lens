import { describe, expect, it } from 'vitest';
import { PIE_ATTRIBUTE_PREFIX, PIE_OTHER_SLICE_KEY } from '../../../src/render/mapping/pieMapping';
import Graph from 'graphology';
import { applyPieChartNodeTypes } from '../../../src/render/adapters/sigma/attributes/sigmaNodeAttributes';
import { SIGMA_NODE_TYPE_PIECHART } from '../../../src/render/adapters/sigma/sigmaRendering.constants';

describe('applyPieChartNodeTypes', () => {
  it('fills slice keys and preserves cluster proxy triangles', () => {
    const graph = new Graph();
    graph.addNode('cluster', {
      type: 'triangle',
      isClusterProxy: true,
      [`${PIE_ATTRIBUTE_PREFIX}region__value__eu`]: 3,
    });
    graph.addNode('leaf', {});
    const sliceKeys = [`${PIE_ATTRIBUTE_PREFIX}region__value__eu`, `${PIE_ATTRIBUTE_PREFIX}region__value__us`];

    applyPieChartNodeTypes(graph, sliceKeys);

    // Cluster proxies remain triangles; the absent slice key is still filled
    // so a later expansion can reuse the registered pie program.
    expect(graph.getNodeAttribute('cluster', 'type')).toBe('triangle');
    expect(graph.getNodeAttribute('cluster', `${PIE_ATTRIBUTE_PREFIX}region__value__us`)).toBe(0);
    // Leaf has no positive pie data: type is left untouched.
    expect(graph.getNodeAttribute('leaf', 'type')).toBeUndefined();
  });

  it('aggregates non-displayed pie keys into the Others slice', () => {
    const graph = new Graph();
    graph.addNode('n', {
      [`${PIE_ATTRIBUTE_PREFIX}region__value__eu`]: 2,
      [`${PIE_ATTRIBUTE_PREFIX}region__value__hidden`]: 5,
    });
    const sliceKeys = [`${PIE_ATTRIBUTE_PREFIX}region__value__eu`, PIE_OTHER_SLICE_KEY];

    applyPieChartNodeTypes(graph, sliceKeys);

    expect(graph.getNodeAttribute('n', PIE_OTHER_SLICE_KEY)).toBe(5);
    expect(graph.getNodeAttribute('n', 'type')).toBe(SIGMA_NODE_TYPE_PIECHART);
  });

  it('leaves node types untouched when there are no slice keys', () => {
    const graph = new Graph();
    graph.addNode('n', {
      type: 'triangle',
      [`${PIE_ATTRIBUTE_PREFIX}region__value__eu`]: 3,
    });

    applyPieChartNodeTypes(graph, []);

    expect(graph.getNodeAttribute('n', 'type')).toBe('triangle');
  });
});
