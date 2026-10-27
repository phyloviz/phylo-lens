export const MANUAL_BRANCH_COLOR = '#7c3aed';

export function isClusterRepresentative(attributes?: Record<string, unknown>): boolean {
  if (attributes?.isBranchCollapsed === true) return false;
  return (
    attributes?.type === 'triangle' ||
    attributes?.isClusterProxy === true ||
    (typeof attributes?.memberCount === 'number' && attributes.memberCount > 1)
  );
}
