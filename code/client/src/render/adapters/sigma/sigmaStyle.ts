import { firstAttributeValue, isTruthyAttribute, normalizeRoleValue } from "./sigmaAttributeUtils";
import {
  PHYLOVIZ_NODE_COMMON_COLOR,
  PHYLOVIZ_NODE_GROUP_FOUNDER_COLOR,
  PHYLOVIZ_NODE_SELECTED_COLOR,
  PHYLOVIZ_NODE_SUBGROUP_FOUNDER_COLOR,
  SIGMA_DISTANCE_EDGE_SIZE_FACTOR,
} from "./sigmaRenderingConstants";

const PHYLOVIZ_ROLE_KEYS = ["phyloviz_role", "st_role", "node_role", "role"];
const PHYLOVIZ_SELECTED_KEYS = ["selected", "is_selected"];
const PHYLOVIZ_GROUP_FOUNDER_KEYS = ["group_founder", "is_group_founder", "founder", "is_founder"];
const PHYLOVIZ_SUBGROUP_FOUNDER_KEYS = [
  "subgroup_founder",
  "sub_group_founder",
  "is_subgroup_founder",
  "is_sub_group_founder",
];

export function derivePhylovizNodeColor(attributes: Record<string, unknown> | undefined): string {
  if (isTruthyAttribute(attributes, PHYLOVIZ_SELECTED_KEYS)) {
    return PHYLOVIZ_NODE_SELECTED_COLOR;
  }

  const role = normalizeRoleValue(firstAttributeValue(attributes, PHYLOVIZ_ROLE_KEYS));
  if (role === "group_founder" || isTruthyAttribute(attributes, PHYLOVIZ_GROUP_FOUNDER_KEYS)) {
    return PHYLOVIZ_NODE_GROUP_FOUNDER_COLOR;
  }

  if (role === "subgroup_founder" || isTruthyAttribute(attributes, PHYLOVIZ_SUBGROUP_FOUNDER_KEYS)) {
    return PHYLOVIZ_NODE_SUBGROUP_FOUNDER_COLOR;
  }

  return PHYLOVIZ_NODE_COMMON_COLOR;
}

export function edgeSizeForDistance(
  distance: number | null | undefined,
  baseSize: number,
  distanceWeighted: boolean,
): number {
  if (!distanceWeighted || typeof distance !== "number" || !Number.isFinite(distance) || distance <= 0) {
    return baseSize;
  }

  return baseSize + Math.log1p(distance) * SIGMA_DISTANCE_EDGE_SIZE_FACTOR;
}
