import type { GraphMetadataValue, GraphViewportNode } from "../../../../api/graphContracts";
import type { GraphDisplayOptions } from "../../../renderer.types";
import {
  buildPieAttributes,
  buildPieCategoryColorAttributes,
  PIE_CATEGORY_COLORS_ATTRIBUTE,
  PIE_PALETTE_ATTRIBUTE,
} from "../../../mapping/pieMapping";
import { deriveSize } from "../../../mapping/visualMapping";
import {
  PHYLOVIZ_NODE_COMMON_COLOR,
  PHYLOVIZ_NODE_SELECTED_BORDER_COLOR,
  PHYLOVIZ_NODE_SELECTED_COLOR,
  SIGMA_NODE_TYPE_BORDER,
  SIGMA_NODE_TYPE_TRIANGLE,
} from "../sigmaRendering.constants";
import { derivePhylovizNodeColor } from "../attributes/sigmaStyle";
import type { ResolvedViewportVisuals } from "./graphViewportAttributes.types";

export const DEFAULT_GRAPH_VIEWER_NODE_SIZE = 5;
export const GRAPH_VIEWER_MEMBER_SIZE_FACTOR = 1.25;
export const GRAPH_VIEWER_MAX_MEMBER_SIZE_BOOST = 6;
export const GRAPH_VIEWER_REPRESENTATIVE_COLOR = "#b45309";
export const GRAPH_VIEWER_NODE_COLOR = PHYLOVIZ_NODE_COMMON_COLOR;

export function buildGraphViewportNodeAttributes(
  node: GraphViewportNode,
  visuals: ResolvedViewportVisuals | null,
  displayOptions?: GraphDisplayOptions,
  selectedNodeId?: string | null,
): Record<string, unknown> {
  // A proxy only renders as an (expandable) triangle when it actually stands in
  // for more than one node. The server materializes a single-member cluster per
  // node at each tier (so every node has a representative for meta-edge
  // rerouting), and those arrive with is_representative === true; drawing them
  // as triangles produced the "cluster with just one node under it" artifact on
  // larger trees. Gating on member_count > 1 renders them as plain leaves.
  const isRepresentative = node.member_count > 1;
  // A focused (searched) leaf wins over every other role/mapping color: it is
  // painted red, enlarged, and given a border so it stands out once its slice
  // loads. Representatives keep their triangle treatment even when focused.
  const isSelected = !isRepresentative && node.id === (selectedNodeId ?? null);
  const metadata = node.metadata ?? undefined;
  // Color precedence: an active metadata visual mapping is an explicit user
  // choice and wins WHEN the node actually has a value for the colour field;
  // otherwise (no mapping, or the node has no value for the mapped field)
  // representatives keep their distinct triangle tone and leaf/member nodes
  // fall back to their PHYLOViZ role color. This keeps "no data" nodes on their
  // role colour instead of a palette slot they don't belong to.
  const mappedValue = visuals ? metadata?.[visuals.colorField] : undefined;
  const hasMappedValue = mappedValue !== undefined && mappedValue !== null && mappedValue !== "";
  const roleColor = isRepresentative ? GRAPH_VIEWER_REPRESENTATIVE_COLOR : deriveViewportNodeColor(node);
  const color = isSelected
    ? PHYLOVIZ_NODE_SELECTED_COLOR
    : visuals && hasMappedValue
      ? visuals.colorForValue(mappedValue)
      : roleColor;
  const baseSize =
    visuals && visuals.numericStats
      ? deriveSize(metadata?.[visuals.sizeField], visuals.numericStats, visuals.scale)
      : nodeSizeForMemberCount(node.member_count);
  const size = isSelected ? Math.max(baseSize * 1.55, baseSize + 6) : baseSize;
  // Node labels are on by default; a representative (triangle) never carries a
  // label, and toggling the node-labels display option off blanks leaf labels.
  const showNodeLabel = displayOptions?.nodeLabels !== false;
  return {
    x: node.x,
    y: node.y,
    size,
    label: isRepresentative || !showNodeLabel ? "" : node.id,
    color,
    cluster_id: node.cluster_id,
    member_count: node.member_count,
    is_cluster_proxy: isRepresentative || undefined,
    type: isSelected ? SIGMA_NODE_TYPE_BORDER : isRepresentative ? SIGMA_NODE_TYPE_TRIANGLE : undefined,
    borderColor: isSelected ? PHYLOVIZ_NODE_SELECTED_BORDER_COLOR : undefined,
    layout_status: node.layout_status,
    ...(metadata ? { metadata } : {}),
    ...pieNodeAttributes(metadata, visuals),
  };
}

export function nodeSizeForMemberCount(memberCount: number): number {
  const safeMemberCount = Math.max(1, memberCount);
  const boost = Math.min(
    GRAPH_VIEWER_MAX_MEMBER_SIZE_BOOST,
    (Math.sqrt(safeMemberCount) - 1) * GRAPH_VIEWER_MEMBER_SIZE_FACTOR,
  );
  return DEFAULT_GRAPH_VIEWER_NODE_SIZE + boost;
}

export function isExpandableRepresentative(attributes: Record<string, unknown>): boolean {
  return (
    attributes.type === SIGMA_NODE_TYPE_TRIANGLE ||
    attributes.is_cluster_proxy === true ||
    (typeof attributes.member_count === "number" && attributes.member_count > 1)
  );
}

// Resolve a leaf/member node's default color from its PHYLOViZ role, mirroring
// the role logic in sigmaNodeAttributes.deriveNodeColor: selected wins, then
// group founder (light green), then sub-group founder (dark green), otherwise
// the common node blue. Roles are read from node metadata under any of the
// accepted key aliases. Representatives (triangles) are colored separately and
// never routed through here.
export function deriveViewportNodeColor(node: GraphViewportNode): string {
  const metadata = node.metadata ?? undefined;
  const attributes = metadata ? { metadata } : undefined;
  return derivePhylovizNodeColor(attributes);
}

// Build pie-chart slice/colour attributes from node metadata when a pie mapping
// is active. Mirrors applyVisualMappings' attribute semantics; ancillary rows
// are unavailable under LoD, so categories come from the server-aggregated
// __category_count__ keys already embedded in node metadata.
function pieNodeAttributes(
  metadata: Record<string, GraphMetadataValue> | undefined,
  visuals: ResolvedViewportVisuals | null,
): Record<string, unknown> {
  const pie = visuals?.pie;
  if (!pie || !metadata) {
    return {};
  }

  const excludedFields = [visuals.sizeField];
  const pieAttributes = buildPieAttributes(metadata, pie, excludedFields, []);
  const pieCategoryColors = buildPieCategoryColorAttributes(metadata, pie, excludedFields, []);

  return {
    ...pieAttributes,
    ...(Object.keys(pieCategoryColors).length > 0 ? { [PIE_CATEGORY_COLORS_ATTRIBUTE]: pieCategoryColors } : {}),
    ...(pie.palette && pie.palette.length > 0 ? { [PIE_PALETTE_ATTRIBUTE]: pie.palette } : {}),
  };
}
