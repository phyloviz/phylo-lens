import type { GraphViewportRequest } from '../../contracts/graph/viewport/GraphViewportRequest';
import type { GraphViewportResult } from '../../contracts/graph/viewport/GraphViewportResult';
import type { GraphViewportNode } from '../../contracts/graph/viewport/GraphViewportNode';
import type { GraphViewportResponseDto } from './models/viewport/GraphViewportResponseDto';
import { GRAPH_API_ERRORS } from './graphErrors';
import type { AncillaryData } from '../../contracts/ancillary';
import { ancillaryValues } from '../../ancillary/ancillaryAccess';

export function annotationKey(nodeId: string, clusterId: string, isRepresentative: boolean): string {
  return JSON.stringify([nodeId, clusterId, isRepresentative]);
}

/** Borrow the current snapshot; do not accumulate an annotation cache across views. */
export function reusableAnnotations(
  request: GraphViewportRequest,
  previous?: GraphViewportResult | null
): ReadonlyMap<string, GraphViewportNode> {
  const nodes = new Map<string, GraphViewportNode>();
  if (previous?.datasetId !== request.datasetId || previous.layoutVersion !== request.layoutVersion) return nodes;
  for (const node of previous.nodes) nodes.set(annotationKey(node.id, node.clusterId, node.isRepresentative), node);
  return nodes;
}

export function reusableObservations(
  known: ReadonlyMap<string, GraphViewportNode>
): ReadonlyMap<string, AncillaryData> {
  const values = new Map<string, AncillaryData>();
  for (const node of known.values()) {
    for (const row of node.ancillaryDistribution ?? []) {
      if (row.referenceId !== undefined) values.set(row.referenceId, row.values);
    }
    for (const isolate of node.isolates ?? []) values.set(`isolate:${isolate.id}`, isolate.ancillaryData);
    if (!node.isRepresentative && !node.isolates?.length)
      values.set(`node:${node.id}`, ancillaryValues(node.annotations));
  }
  return values;
}

export function restoreViewportAnnotations(
  result: GraphViewportResult,
  response: GraphViewportResponseDto,
  known: ReadonlyMap<string, GraphViewportNode>,
  request: GraphViewportRequest,
  observations: ReadonlyMap<string, AncillaryData>
): GraphViewportResult {
  const matchingLayout = result.datasetId === request.datasetId && result.layoutVersion === request.layoutVersion;
  function retainedValues(reference: string | undefined): AncillaryData {
    const values = reference === undefined ? undefined : observations.get(reference);
    if (!values || !matchingLayout) throw new Error(GRAPH_API_ERRORS.invalidViewportResponse);
    return values;
  }
  return {
    ...result,
    nodes: result.nodes.map((node, index) => {
      if (!response.nodes[index].annotations_cached) {
        return {
          ...node,
          isolates: node.isolates?.map((isolate, isolateIndex) => {
            if (!response.nodes[index].isolates?.[isolateIndex].metadata_cached) return isolate;
            return { ...isolate, ancillaryData: retainedValues(`isolate:${isolate.id}`) };
          }),
          ancillaryDistribution: node.ancillaryDistribution?.map((row, rowIndex) => {
            if (!response.nodes[index].ancillary_distribution?.[rowIndex].values_cached) return row;
            return { ...row, values: retainedValues(row.referenceId) };
          }),
        };
      }
      const previous = known.get(annotationKey(node.id, node.clusterId, node.isRepresentative));
      if (!previous || !matchingLayout) {
        throw new Error(GRAPH_API_ERRORS.invalidViewportResponse);
      }
      return {
        ...node,
        annotations: previous.annotations,
        isolates: previous.isolates,
        ancillaryDistribution: previous.ancillaryDistribution,
        treeIndex: previous.treeIndex,
      };
    }),
  };
}
