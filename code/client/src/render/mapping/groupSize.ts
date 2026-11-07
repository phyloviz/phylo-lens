export type GroupSizeMappingOptions = {
  /** Radius at the reference zoom before adding represented-node area. Default: 6. */
  readonly minimumSize?: number;
  /** Additional squared-radius units per represented node after the first. Default: 1. */
  readonly areaPerNode?: number;
  /** Upper radius approached gradually as counts grow. Default: 12. */
  readonly maximumSize?: number;
};

export type ResolvedGroupSizeMapping = {
  readonly minimumSize: number;
  readonly areaPerNode: number;
  readonly maximumSize: number;
};

const DEFAULT_GROUP_SIZE: ResolvedGroupSizeMapping = Object.freeze({
  minimumSize: 6,
  areaPerNode: 1,
  maximumSize: 12,
});

export function resolveGroupSize(options?: GroupSizeMappingOptions): ResolvedGroupSizeMapping {
  if (!options) return DEFAULT_GROUP_SIZE;
  const minimumSize = options.minimumSize ?? DEFAULT_GROUP_SIZE.minimumSize;
  const areaPerNode = options.areaPerNode ?? DEFAULT_GROUP_SIZE.areaPerNode;
  const maximumSize = options.maximumSize ?? DEFAULT_GROUP_SIZE.maximumSize;

  if (!Number.isFinite(minimumSize) || minimumSize <= 0 || !Number.isFinite(areaPerNode) || areaPerNode <= 0)
    throw new RangeError('Group minimum size and area per node must be finite positive numbers.');
  if (!Number.isFinite(maximumSize * maximumSize) || maximumSize < minimumSize)
    throw new RangeError('Group maximum size must be finite and at least the minimum size.');

  return { minimumSize, areaPerNode, maximumSize };
}

/** Compress count-dependent area into a finite visual range, without a hard count cutoff.
 * Counts are canonical graph nodes, including the retained root of a manual fold.
 * The mapping is independent of other visible groups and camera position.
 */
export function groupSizeForCount(count: number, mapping: ResolvedGroupSizeMapping): number {
  const members = Number.isFinite(count) ? Math.max(1, count) : 1;
  const baseArea = mapping.minimumSize ** 2;
  const availableArea = mapping.maximumSize ** 2 - baseArea;
  const additionalArea = (members - 1) * mapping.areaPerNode;
  if (availableArea === 0 || additionalArea === 0) return mapping.minimumSize;
  const fraction = 1 / (1 + availableArea / additionalArea);
  return Math.min(mapping.maximumSize, Math.sqrt(baseArea + availableArea * fraction));
}
