export const PHYLOVIZ_UNION_NODE_ID_PREFIX = "union_";
export const LEGACY_INTERNAL_NODE_ID_PREFIX = "internal_";

// PHYLOViZ desktop renders generated union nodes as structural junctions.
export const PHYLOVIZ_UNION_NODE_COLOR = "#ffffff";
export const PHYLOVIZ_UNION_NODE_SIZE = 0;

export function isPhyloVizUnionNode(
  nodeId: string,
  attributes?: Record<string, unknown>,
): boolean {
  return (
    nodeId.startsWith(PHYLOVIZ_UNION_NODE_ID_PREFIX) ||
    nodeId.startsWith(LEGACY_INTERNAL_NODE_ID_PREFIX) ||
    attributes?.is_union_node === true ||
    attributes?.is_internal_node === true
  );
}
