import type { GraphViewportRequest } from '../../contracts/graph/viewport/GraphViewportRequest';
import type { GraphViewportResult } from '../../contracts/graph/viewport/GraphViewportResult';
import type { GraphViewportNode } from '../../contracts/graph/viewport/GraphViewportNode';
import type { GraphViewportResponseDto } from './models/viewport/GraphViewportResponseDto';
import { GRAPH_API_ERRORS } from './graphErrors';

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

export function restoreViewportAnnotations(
  result: GraphViewportResult,
  response: GraphViewportResponseDto,
  known: ReadonlyMap<string, GraphViewportNode>,
  request: GraphViewportRequest
): GraphViewportResult {
  return {
    ...result,
    nodes: result.nodes.map((node, index) => {
      if (!response.nodes[index].annotations_cached) return node;
      const previous = known.get(annotationKey(node.id, node.clusterId, node.isRepresentative));
      if (!previous || result.datasetId !== request.datasetId || result.layoutVersion !== request.layoutVersion) {
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
