import type Graph from "graphology";
import type { PositionedNode } from "../../../../contracts/positioned";
import { PIE_ATTRIBUTE_PREFIX, PIE_OTHER_SLICE_KEY } from "../../../mapping/pieMapping";
import { isTruthyAttribute, toPositiveNumber } from "./sigmaAttributeUtils";
import { deriveNodeLabel } from "./sigmaLabels";
import {
  PHYLOVIZ_NODE_SELECTED_COLOR,
  SIGMA_DEFAULT_NODE_SIZE,
  SIGMA_NODE_TYPE_DEFAULT,
  SIGMA_NODE_TYPE_PIECHART,
  SIGMA_NODE_TYPE_TRIANGLE,
} from "../sigmaRendering.constants";
import { isUnionNode, UNION_NODE_COLOR, UNION_NODE_SIZE } from "../../../mapping/unionNodes";
import type { SigmaRendererOptions } from "../sigmaRenderer.types";
import { derivePhylovizNodeColor } from "./sigmaStyle";

export function addPositionedNode(
  graph: Graph,
  node: PositionedNode,
  pieSliceKeys: readonly string[],
  rendererOptions: SigmaRendererOptions,
  triangleRotation = 0,
): void {
  const unionNode = isUnionNode(node.id, node.attributes);
  const pieAttributes: Record<string, number> = {};
  const displayedPieKeys = new Set(pieSliceKeys.filter((key) => key !== PIE_OTHER_SLICE_KEY));
  pieSliceKeys.forEach((key) => {
    pieAttributes[key] = unionNode
      ? 0
      : key === PIE_OTHER_SLICE_KEY
        ? deriveOtherPieValue(node.attributes, displayedPieKeys)
        : toPositiveNumber(node.attributes?.[key]);
  });
  const hasPieData = Object.values(pieAttributes).some((value) => value > 0);
  const isClusterProxy = node.attributes?.is_cluster_proxy === true;
  const nodeType =
    !unionNode && hasPieData && pieSliceKeys.length > 0
      ? SIGMA_NODE_TYPE_PIECHART
      : isClusterProxy
        ? SIGMA_NODE_TYPE_TRIANGLE
        : SIGMA_NODE_TYPE_DEFAULT;
  const nodeSize = unionNode ? UNION_NODE_SIZE : (node.size ?? SIGMA_DEFAULT_NODE_SIZE);

  graph.addNode(node.id, {
    x: node.x,
    y: node.y,
    size: nodeSize,
    label:
      rendererOptions.label?.enabled === false || rendererOptions.display?.nodeLabels === false
        ? ""
        : deriveNodeLabel(node.id, node.attributes),
    ...(node.attributes ?? {}),
    ...pieAttributes,
    type: nodeType,
    color: deriveNodeColor(node),
    borderColor: undefined,
    triangleRotation,
  });
}

// Flip synced nodes to the piechart node type once the piechart program for
// `sliceKeys` has been registered. Mirrors addPositionedNode's pie handling for
// the LoD sync path, where attributes are written directly to graphology and
// nodes cannot be re-added through addPositionedNode. Ensures every displayed
// slice key (plus the aggregated Others bucket) is present on each pie node so
// the @sigma/node-piechart program can read them.
export function applyPieChartNodeTypes(graph: Graph, sliceKeys: readonly string[]): void {
  if (sliceKeys.length === 0) {
    return;
  }

  const displayedPieKeys = new Set(sliceKeys.filter((key) => key !== PIE_OTHER_SLICE_KEY));
  graph.forEachNode((nodeId, rawAttributes) => {
    const attributes = rawAttributes as Record<string, unknown>;
    const unionNode = isUnionNode(nodeId, attributes);
    let hasPieData = false;
    sliceKeys.forEach((key) => {
      const value = unionNode
        ? 0
        : key === PIE_OTHER_SLICE_KEY
          ? deriveOtherPieValue(attributes, displayedPieKeys)
          : toPositiveNumber(attributes[key]);
      graph.setNodeAttribute(nodeId, key, value);
      if (value > 0) {
        hasPieData = true;
      }
    });

    if (!unionNode && hasPieData) {
      graph.setNodeAttribute(nodeId, "type", SIGMA_NODE_TYPE_PIECHART);
    }
  });
}

function deriveOtherPieValue(attributes: Record<string, unknown> | undefined, displayedPieKeys: Set<string>): number {
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

function deriveNodeColor(node: PositionedNode): string {
  if (isUnionNode(node.id, node.attributes)) {
    return UNION_NODE_COLOR;
  }

  if (isTruthyAttribute(node.attributes, ["selected", "is_selected"])) {
    return PHYLOVIZ_NODE_SELECTED_COLOR;
  }

  return derivePhylovizNodeColor(node.attributes);
}
