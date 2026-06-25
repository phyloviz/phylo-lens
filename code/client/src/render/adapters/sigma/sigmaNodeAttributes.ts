import type Graph from "graphology";
import type { PositionedNode } from "../../../contracts/positioned";
import {
  PIE_ATTRIBUTE_PREFIX,
  PIE_OTHER_SLICE_KEY,
} from "../../pieMapping";
import {
  firstAttributeValue,
  isTruthyAttribute,
  normalizeRoleValue,
  toPositiveNumber,
} from "./sigmaAttributeUtils";
import { deriveNodeLabel } from "./sigmaLabels";
import {
  PHYLOVIZ_NODE_COMMON_COLOR,
  PHYLOVIZ_NODE_GROUP_FOUNDER_COLOR,
  PHYLOVIZ_NODE_SELECTED_BORDER_COLOR,
  PHYLOVIZ_NODE_SELECTED_COLOR,
  PHYLOVIZ_NODE_SUBGROUP_FOUNDER_COLOR,
  SIGMA_DEFAULT_NODE_SIZE,
  SIGMA_NODE_TYPE_BORDER,
  SIGMA_NODE_TYPE_DEFAULT,
  SIGMA_NODE_TYPE_PIECHART,
  SIGMA_NODE_TYPE_TRIANGLE,
} from "./sigmaRenderingConstants";
import {
  isPhyloVizUnionNode,
  PHYLOVIZ_UNION_NODE_COLOR,
  PHYLOVIZ_UNION_NODE_SIZE,
} from "../../phylovizNodes";
import type { SigmaRendererOptions } from "./sigmaTypes";

export function addPositionedNode(
  graph: Graph,
  node: PositionedNode,
  pieSliceKeys: readonly string[],
  rendererOptions: SigmaRendererOptions,
  selectedNodeId?: string | null,
  triangleRotation = 0,
): void {
  const isUnionNode = isPhyloVizUnionNode(node.id, node.attributes);
  const pieAttributes: Record<string, number> = {};
  const displayedPieKeys = new Set(
    pieSliceKeys.filter((key) => key !== PIE_OTHER_SLICE_KEY),
  );
  pieSliceKeys.forEach((key) => {
    pieAttributes[key] = isUnionNode
      ? 0
      : key === PIE_OTHER_SLICE_KEY
        ? deriveOtherPieValue(node.attributes, displayedPieKeys)
        : toPositiveNumber(node.attributes?.[key]);
  });
  const hasPieData = Object.values(pieAttributes).some((value) => value > 0);
  const isClusterProxy = node.attributes?.is_cluster_proxy === true;
  const isSelectedNode = !isUnionNode && node.id === selectedNodeId;
  const nodeType =
    isSelectedNode
      ? SIGMA_NODE_TYPE_BORDER
        : !isUnionNode && hasPieData && pieSliceKeys.length > 0
        ? SIGMA_NODE_TYPE_PIECHART
        : isClusterProxy
          ? SIGMA_NODE_TYPE_TRIANGLE
          : SIGMA_NODE_TYPE_DEFAULT;
  const nodeSize = isUnionNode
    ? PHYLOVIZ_UNION_NODE_SIZE
    : (node.size ?? SIGMA_DEFAULT_NODE_SIZE);

  graph.addNode(node.id, {
    x: node.x,
    y: node.y,
    size: isSelectedNode ? Math.max(nodeSize * 1.55, nodeSize + 6) : nodeSize,
    label:
      !isSelectedNode &&
      (rendererOptions.label?.enabled === false ||
        rendererOptions.display?.nodeLabels === false)
        ? ""
        : deriveNodeLabel(node.id, node.attributes),
    ...(node.attributes ?? {}),
    ...pieAttributes,
    type: nodeType,
    color: deriveNodeColor(node, selectedNodeId),
    borderColor: isSelectedNode
      ? PHYLOVIZ_NODE_SELECTED_BORDER_COLOR
      : undefined,
    triangleRotation,
    forceLabel: isSelectedNode || undefined,
  });
}

function deriveOtherPieValue(
  attributes: Record<string, unknown> | undefined,
  displayedPieKeys: Set<string>,
): number {
  if (!attributes) {
    return 0;
  }

  return Object.entries(attributes).reduce((sum, [key, value]) => {
    if (
      key === PIE_OTHER_SLICE_KEY ||
      !key.startsWith(PIE_ATTRIBUTE_PREFIX) ||
      displayedPieKeys.has(key)
    ) {
      return sum;
    }

    return sum + toPositiveNumber(value);
  }, 0);
}

function deriveNodeColor(
  node: PositionedNode,
  selectedNodeId?: string | null,
): string {
  if (
    isPhyloVizUnionNode(node.id, node.attributes)
  ) {
    return PHYLOVIZ_UNION_NODE_COLOR;
  }

  if (
    node.id === selectedNodeId ||
    isTruthyAttribute(node.attributes, ["selected", "is_selected"])
  ) {
    return PHYLOVIZ_NODE_SELECTED_COLOR;
  }

  const role = normalizeRoleValue(
    firstAttributeValue(node.attributes, [
      "phyloviz_role",
      "st_role",
      "node_role",
      "role",
      "category",
      "type",
    ]),
  );

  if (
    role === "group_founder" ||
    isTruthyAttribute(node.attributes, [
      "group_founder",
      "is_group_founder",
      "founder",
      "is_founder",
    ])
  ) {
    return PHYLOVIZ_NODE_GROUP_FOUNDER_COLOR;
  }

  if (
    role === "subgroup_founder" ||
    isTruthyAttribute(node.attributes, [
      "subgroup_founder",
      "sub_group_founder",
      "is_subgroup_founder",
      "is_sub_group_founder",
    ])
  ) {
    return PHYLOVIZ_NODE_SUBGROUP_FOUNDER_COLOR;
  }

  return PHYLOVIZ_NODE_COMMON_COLOR;
}
