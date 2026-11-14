import { expect, it } from 'vitest';
import { toGraphViewportResult } from '../src/services/graph/mappers/graphViewportMappers';
import { toGraphPrepareRequestDto, toGraphPrepareStatus } from '../src/services/graph/mappers/graphPrepareMappers';
import { isGraphPrepareRequestDto } from '../src/services/graph/guards/graphPrepareGuards';
import type { GraphViewportResponseDto } from '../src/services/graph/models/viewport/GraphViewportResponseDto';

it('transports a zero cutoff explicitly and rejects invalid distances before preparing', () => {
  const dto = toGraphPrepareRequestDto({ format: 'newick', content: '(a:0,b:1)root;', distanceCutoff: 0 });
  expect(dto.distance_cutoff).toBe(0);
  expect(isGraphPrepareRequestDto(dto)).toBe(true);
  expect(isGraphPrepareRequestDto({ ...dto, distance_cutoff: -1 })).toBe(false);
  expect(isGraphPrepareRequestDto({ ...dto, distance_cutoff: Infinity })).toBe(false);
});

it('maps wire fields and takes ownership of ancillary rows, observations and schemas', () => {
  const dto = {
    dataset_id: 'tree',
    layout_version: 'layout',
    zoom: 1,
    layout_status: 'ready',
    truncated: false,
    total_node_count: 1,
    metadata_schema: [{ key: 'country', type: 'string' }],
    global_bounds: { min_x: -10, max_x: 10, min_y: -5, max_y: 5 },
    edges: [],
    nodes: [
      {
        id: 'A',
        cluster_id: 'cluster',
        x: 1,
        y: 2,
        layout_status: 'ready',
        member_count: 1,
        is_representative: false,
        tree_index: { component_id: 'A', parent_id: null, depth: 0, start: 0, end: 2 },
        metadata: { country: 'PT' },
        isolates: [{ id: 'isolate', metadata: { country: 'PT' } }],
        ancillary_distribution: [{ values: { country: 'PT' }, count: 1 }],
      },
    ],
  } satisfies GraphViewportResponseDto;
  const result = toGraphViewportResult(dto);
  dto.nodes[0].tree_index.end = 999;
  dto.metadata_schema[0].key = 'changed';
  dto.nodes[0].isolates[0].metadata.country = 'changed';
  dto.nodes[0].ancillary_distribution[0].values.country = 'changed';
  expect(result).toMatchObject({
    datasetId: 'tree',
    layoutVersion: 'layout',
    globalBounds: { minX: -10, maxX: 10, minY: -5, maxY: 5 },
    ancillarySchema: [{ key: 'country', type: 'string' }],
  });
  expect(result.nodes[0]).toMatchObject({
    id: 'A',
    treeIndex: { componentId: 'A', parentId: null, depth: 0, start: 0, end: 2 },
    clusterId: 'cluster',
    annotations: { ancillaryData: { country: 'PT' } },
    isolates: [{ id: 'isolate', ancillaryData: { country: 'PT' } }],
    ancillaryDistribution: [{ values: { country: 'PT' }, count: 1 }],
  });
  expect(result).not.toHaveProperty('dataset_id');
});

it('owns prepare warnings and exposes structured failure details in camelCase', () => {
  const warnings = ['A layout warning'];
  const technicalRoots = ['root'];
  const ready = toGraphPrepareStatus({
    job_id: 'job',
    status: 'ready',
    result: {
      dataset_id: 'tree',
      layout_version: 'layout',
      layout_status: 'ready',
      node_count: 2,
      edge_count: 1,
      cluster_count: 1,
      warnings,
      technical_roots: technicalRoots,
    },
  });
  warnings.push('Changed');
  expect(ready.result?.warnings).toEqual(['A layout warning']);
  technicalRoots.push('changed');
  expect(ready.result?.technicalRoots).toEqual(['root']);
  const failed = toGraphPrepareStatus({
    job_id: 'job',
    status: 'failed',
    error_details: {
      algorithm: 'sfdp',
      stage: 'global_layout',
      exit_status: 17,
      timeout_seconds: 60,
      stderr: 'failed',
    },
  });
  expect(failed.errorDetails).toEqual({
    algorithm: 'sfdp',
    stage: 'global_layout',
    exitStatus: 17,
    timeoutSeconds: 60,
    stderr: 'failed',
    detail: undefined,
  });
});
