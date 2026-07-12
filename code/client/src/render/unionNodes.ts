export const UNION_NODE_ID_PREFIX = "union_";

// The server's Newick parser only ever emits generated structural ids of the
// shape `union_<counter>` (with an optional `_<n>` collision suffix), i.e. the
// prefix followed by digits. Matching that exact shape — instead of any id that
// merely starts with the prefix — keeps a real isolate labelled e.g.
// "union_sample" from being silently hidden as a structural junction.
const GENERATED_UNION_NODE_ID = /^union_[0-9]+(?:_[0-9]+)*$/;

// Union nodes are rendered as structural junctions.
export const UNION_NODE_COLOR = "#ffffff";
export const UNION_NODE_SIZE = 0;

export function isUnionNode(nodeId: string, attributes?: Record<string, unknown>): boolean {
  // An explicit structural flag is authoritative; the id-shape check is the
  // fallback for the generated-id convention the server actually produces.
  return attributes?.is_union_node === true || GENERATED_UNION_NODE_ID.test(nodeId);
}
