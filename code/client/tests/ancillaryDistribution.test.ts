import { describe, expect, it } from 'vitest';
import { calculateAncillaryDistribution } from '../src/ancillary/ancillaryDistribution';
import { getAncillaryFields } from '../src/ancillary/ancillaryFields';
import { graphSnapshotFromViewportResponse } from '../src/app/workbench/viewport/viewportSnapshot';
import { detectPieSliceKeys, resolvePieSliceColors } from '../src/render/mapping/pieColors';
import { viewportNode, viewportResult } from './fixtures/graph';
import { freezeInput } from './helpers/state';

const graph = () =>
  graphSnapshotFromViewportResponse(
    viewportResult({
      nodes: [
        viewportNode('a', {
          isolates: [
            { id: 'i1', ancillaryData: { country: 'PT', year: 2020 } },
            { id: 'i2', ancillaryData: { country: 'ES', year: 2021 } },
          ],
        }),
        viewportNode('b', { ancillaryDistribution: [{ values: { country: 'PT', year: 2020 }, count: 3 }] }),
      ],
    }),
    { visualMapping: { pie: { fields: ['country'] } } }
  );

describe('ancillary distributions', () => {
  it('counts original isolates and weighted groups without changing the graph', () => {
    const input = freezeInput(graph());
    const distribution = calculateAncillaryDistribution(input, { fields: ['country'] });
    expect(distribution).toMatchObject({ observationCount: 5, nodeCount: 2 });
    expect(distribution?.categories.map(({ label, count, percentage }) => ({ label, count, percentage }))).toEqual([
      { label: 'PT', count: 4, percentage: 80 },
      { label: 'ES', count: 1, percentage: 20 },
    ]);
  });

  it('retains correlations between fields rather than inventing combinations', () => {
    const distribution = calculateAncillaryDistribution(graph(), { fields: ['country', 'year'] });
    expect(distribution?.categories.map(({ label, count }) => ({ label, count }))).toEqual([
      { label: 'country: "PT" · year: "2020"', count: 4 },
      { label: 'country: "ES" · year: "2021"', count: 1 },
    ]);
  });

  it('keeps selected-node colors consistent with the graph and overview', () => {
    const input = graph();
    const all = calculateAncillaryDistribution(input, { fields: ['country'] })!;
    const selected = calculateAncillaryDistribution(input, {
      fields: ['country'],
      includeNodeIds: new Set(['a']),
    })!;
    const colors = resolvePieSliceColors(input.nodes, detectPieSliceKeys(input.nodes));
    for (const category of selected.categories) {
      expect(category.color).toBe(all.categories.find(item => item.key === category.key)?.color);
      expect(category.color).toBe(colors[category.key]);
    }
    expect(selected.categories.map(item => item.percentage)).toEqual([50, 50]);
  });

  it('groups high-cardinality values into Other while preserving total counts', () => {
    const input = graphSnapshotFromViewportResponse(
      viewportResult({
        nodes: Array.from({ length: 20 }, (_, index) =>
          viewportNode(String(index), {
            ancillaryDistribution: [{ values: { country: `country-${index}` }, count: index + 1 }],
          })
        ),
      }),
      { visualMapping: { pie: { fields: ['country'] } } }
    );
    const result = calculateAncillaryDistribution(input)!;
    expect(result.categories.length).toBeLessThanOrEqual(12);
    expect(result.categories.some(category => category.label === 'Other (grouped)')).toBe(true);
    expect(result.categories.reduce((sum, category) => sum + category.count, 0)).toBe(210);
    const ungrouped = calculateAncillaryDistribution(input, { fields: ['country'], groupCategories: false });
    expect(ungrouped?.categories).toHaveLength(20);
  });

  it('handles missing values, literal category names and live color overrides', () => {
    const input = graphSnapshotFromViewportResponse(
      viewportResult({
        nodes: [
          viewportNode('a', {
            ancillaryDistribution: [
              { values: {}, count: 1 },
              { values: { country: 'Missing' }, count: 2 },
              { values: { country: 'PT' }, count: 3 },
            ],
          }),
        ],
      }),
      { visualMapping: { pie: { fields: ['country'] } } }
    );
    const result = calculateAncillaryDistribution(input, {
      fields: ['country'],
      categoryColors: { PT: '#123456' },
    });
    expect(result?.categories.map(category => [category.label, category.count])).toEqual([
      ['PT', 3],
      ['"Missing"', 2],
      ['Missing', 1],
    ]);
    expect(result?.categories[0].color).toBe('#123456');
    expect(calculateAncillaryDistribution(input, { includeNodeIds: new Set() })).toBeNull();
  });

  it('exposes ancillary columns rather than generated profile and category-count keys', () => {
    const fields = getAncillaryFields(graph());
    expect(fields.map(field => field.name)).toEqual(['country', 'year']);
    expect(fields.find(field => field.name === 'country')?.distinctValueCount).toBe(2);
  });
});
