import { expect, it } from 'vitest';
import sizeFieldControls from '../src/app/shell/controls/sizeFieldControls';
import { decodeApiMetadata } from '../src/ancillary/apiMetadata';
import type { PositionedGraph } from '../src/contracts/positioned';

it('offers readable numeric node values and retains a choice missing from a later slice', () => {
  const select = document.createElement('select');
  const controls = sizeFieldControls(select);
  const graph: PositionedGraph = {
    nodes: [
      {
        id: 'a',
        x: 0,
        y: 0,
        attributes: {
          annotations: decodeApiMetadata({
            age: '12',
            country: 'Portugal',
            empty: '',
            enabled: true,
            invalid: 'NaN',
            score: 2,
            profile_count: 4,
            __category_count__country__value__Portugal: 4,
          }),
        },
      },
    ],
    edges: [],
    viewMeta: { layout: 'server', lodLevel: 0 },
  };
  controls.reset();
  controls.refresh(graph);
  expect([...select.options].map(option => option.value)).toEqual(['profile_count', 'age', 'score']);
  select.value = 'score';
  controls.refresh({ ...graph, nodes: [] });
  expect(select.value).toBe('score');
  expect(select.selectedOptions[0]?.textContent).toContain('not in current view');
  controls.reset();
  controls.refresh({ ...graph, nodes: [] });
  expect([...select.options].map(option => option.value)).toEqual(['profile_count']);
  controls.reset('explicit-payload-field');
  expect(select.value).toBe('explicit-payload-field');
});
