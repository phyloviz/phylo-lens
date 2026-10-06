export function isClusterRepresentative(attributes?: Record<string, unknown>): boolean {
  return (
    attributes?.type === 'triangle' ||
    attributes?.isClusterProxy === true ||
    (typeof attributes?.memberCount === 'number' && attributes.memberCount > 1)
  );
}
