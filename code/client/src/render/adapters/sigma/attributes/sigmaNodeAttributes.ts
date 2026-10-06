import type Graph from 'graphology';
import type { PositionedEdge, PositionedNode } from '../../../../contracts/positioned';
import { PIE_ATTRIBUTE_PREFIX, PIE_OTHER_SLICE_KEY } from '../../../mapping/pieMapping';
import { isTruthyAttribute, toPositiveNumber } from './sigmaAttributeUtils';
import { deriveNodeLabel } from './sigmaLabels';
import {
  PHYLOVIZ_CLUSTER_COLOR,
  PHYLOVIZ_NODE_SELECTED_COLOR,
  SIGMA_DEFAULT_NODE_SIZE,
  SIGMA_NODE_TYPE_DEFAULT,
  SIGMA_NODE_TYPE_PIECHART,
  SIGMA_NODE_TYPE_TRIANGLE,
} from '../sigmaRendering.constants';
import { isUnionNode, UNION_NODE_COLOR, UNION_NODE_SIZE } from '../../../mapping/unionNodes';
import type { SigmaRendererOptions } from '../sigmaRenderer.types';
import { derivePhylovizNodeColor } from './sigmaStyle';

/** Initial renders derive styles; viewport snapshots already contain prepared styles. */
export function addPositionedNodes(
  graph: Graph,
  nodes: readonly PositionedNode[],
  rendererOptions?: SigmaRendererOptions,
  pieSliceKeys: readonly string[] = []
): void {
  const displayedPieKeys = new Set(pieSliceKeys.filter(key => key !== PIE_OTHER_SLICE_KEY));
  nodes.forEach(node => {
    if (rendererOptions) {
      addPositionedNode(graph, node, pieSliceKeys, rendererOptions, displayedPieKeys);
    } else {
      graph.addNode(node.id, {
        ...(node.attributes ?? {}),
        x: node.x,
        y: node.y,
        size: node.size,
        color: node.attributes?.isClusterProxy === true ? derivePositionedNodeColor(node) : node.color,
      });
    }
  });
}

function addPositionedNode(
  graph: Graph,
  node: PositionedNode,
  pieSliceKeys: readonly string[],
  rendererOptions: SigmaRendererOptions,
  displayedPieKeys: ReadonlySet<string>
): void {
  const unionNode = isUnionNode(node.id, node.attributes);
  const pieAttributes: Record<string, number> = {};
  pieSliceKeys.forEach(key => {
    pieAttributes[key] = pieValueForKey(key, node.attributes, displayedPieKeys, unionNode);
  });
  const hasPieData = Object.values(pieAttributes).some(value => value > 0);
  const isClusterProxy = node.attributes?.isClusterProxy === true;
  const nodeType = isClusterProxy
    ? SIGMA_NODE_TYPE_TRIANGLE
    : !unionNode && hasPieData && pieSliceKeys.length > 0
      ? SIGMA_NODE_TYPE_PIECHART
      : SIGMA_NODE_TYPE_DEFAULT;
  const nodeSize = unionNode ? UNION_NODE_SIZE : (node.size ?? SIGMA_DEFAULT_NODE_SIZE);

  graph.addNode(node.id, {
    x: node.x,
    y: node.y,
    size: nodeSize,
    ...(node.attributes ?? {}),
    ...pieAttributes,
    type: nodeType,
    color: derivePositionedNodeColor(node),
    borderColor: undefined,
    label:
      rendererOptions.label?.enabled === false || rendererOptions.display?.nodeLabels === false
        ? ''
        : deriveNodeLabel(node.id, node.attributes),
    triangleRotation: 0,
  });
}

// Fill registered pie slots, including Other, while preserving cluster triangles.
export function applyPieChartNodeTypes(graph: Graph, sliceKeys: readonly string[]): void {
  if (sliceKeys.length === 0) {
    return;
  }

  const displayedPieKeys = new Set(sliceKeys.filter(key => key !== PIE_OTHER_SLICE_KEY));
  graph.forEachNode((nodeId, rawAttributes) => {
    const attributes = rawAttributes as Record<string, unknown>;
    const unionNode = isUnionNode(nodeId, attributes);
    let hasPieData = false;
    sliceKeys.forEach(key => {
      const value = pieValueForKey(key, attributes, displayedPieKeys, unionNode);
      graph.setNodeAttribute(nodeId, key, value);
      if (value > 0) {
        hasPieData = true;
      }
    });

    // A cluster proxy is an interaction affordance; it must stay a triangle so
    // its tip continues to identify the edge that expands the cluster. Pies
    // remain available for ordinary nodes only.
    if (!unionNode && attributes.isClusterProxy !== true && hasPieData) {
      graph.setNodeAttribute(nodeId, 'type', SIGMA_NODE_TYPE_PIECHART);
    }
  });
}

function pieValueForKey(
  key: string,
  attributes: PositionedNode['attributes'],
  displayedPieKeys: ReadonlySet<string>,
  unionNode: boolean
): number {
  if (unionNode) return 0;
  return key === PIE_OTHER_SLICE_KEY
    ? deriveOtherPieValue(attributes, displayedPieKeys)
    : toPositiveNumber(attributes?.[key]);
}

function deriveOtherPieValue(attributes: PositionedNode['attributes'], displayedPieKeys: ReadonlySet<string>): number {
  if (!attributes) {
    return 0;
  }

  return Object.entries(attributes).reduce((sum, [key, value]) => {
    if (key === PIE_OTHER_SLICE_KEY || !key.startsWith(PIE_ATTRIBUTE_PREFIX) || displayedPieKeys.has(key)) {
      return sum;
    }

    return sum + toPositiveNumber(value);
  }, 0);
}

export function derivePositionedNodeColor(node: PositionedNode): string {
  if (isUnionNode(node.id, node.attributes)) {
    return UNION_NODE_COLOR;
  }

  if (node.attributes?.isClusterProxy === true) {
    return PHYLOVIZ_CLUSTER_COLOR;
  }

  if (isTruthyAttribute(node.attributes, ['selected', 'is_selected'])) {
    return PHYLOVIZ_NODE_SELECTED_COLOR;
  }

  return derivePhylovizNodeColor(node.attributes);
}

export function applyClusterTriangleRotations(graph: Graph, edges: readonly PositionedEdge[]): void {
  edges.forEach(edge => {
    if (!graph.hasNode(edge.source) || !graph.hasNode(edge.target)) {
      return;
    }

    const source = graph.getNodeAttributes(edge.source);
    const target = graph.getNodeAttributes(edge.target);

    if (source.isClusterProxy === true) {
      graph.setNodeAttribute(
        edge.source,
        'triangleRotation',
        Math.atan2(Number(target.y) - Number(source.y), Number(target.x) - Number(source.x))
      );
    }
    if (target.isClusterProxy === true) {
      graph.setNodeAttribute(
        edge.target,
        'triangleRotation',
        Math.atan2(Number(source.y) - Number(target.y), Number(source.x) - Number(target.x))
      );
    }
  });
}
