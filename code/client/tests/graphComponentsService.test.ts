import { expect, it, vi } from 'vitest';
import { createGraphClient } from '../src/services/graph/graphService';
import { toDatasetId, toLayoutVersion } from '../src/contracts/graph/graphIdentifiers';
const request = { datasetId: toDatasetId('forest'), layoutVersion: toLayoutVersion('v1'), after: 5, limit: 2 };
const response = {
  dataset_id: 'forest',
  layout_version: 'v1',
  components: [{ component_id: 'root', node_count: 10, min_x: 0, max_x: 1, min_y: -1, max_y: 1 }],
  next_cursor: 10,
};
it('maps a bounded component page at the HTTP boundary', async () => {
  const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(response)));
  const client = createGraphClient({ baseUrl: 'http://localhost', fetchImpl });
  expect(await client.readComponents!(request)).toEqual({
    components: [{ id: 'root', nodeCount: 10, bounds: { minX: 0, maxX: 1, minY: -1, maxY: 1 } }],
    nextCursor: 10,
  });
  expect(JSON.parse(fetchImpl.mock.calls[0][1]!.body as string)).toEqual({
    dataset_id: 'forest',
    layout_version: 'v1',
    after: 5,
    limit: 2,
  });
});
it.each([
  { ...response, dataset_id: 'another' },
  { ...response, layout_version: 'another' },
  { ...response, next_cursor: 5 },
  { ...response, components: [{ ...response.components[0], node_count: -1 }] },
  { ...response, components: [{ ...response.components[0], min_x: 2 }] },
])('rejects invalid or mismatched pages', async body => {
  const client = createGraphClient({ baseUrl: '', fetchImpl: async () => new Response(JSON.stringify(body)) });
  await expect(client.readComponents!(request)).rejects.toThrow('Invalid forest component response.');
});
