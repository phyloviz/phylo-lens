import { describe, expect, it } from 'vitest';
import { groupSizeForCount, resolveGroupSize } from '../src/render/mapping/groupSize';
import { copyVisualMapping } from '../src/render/mapping/visualMapping';

describe('group size mapping', () => {
  it('keeps default sizes finite and bounded while distinguishing counts beyond the old cutoff', () => {
    const mapping = resolveGroupSize();
    const radius = (count: number) => groupSizeForCount(count, mapping);
    expect(radius(2)).toBeGreaterThan(6);
    expect(radius(2400)).toBeGreaterThan(radius(24));
    expect(radius(24_000)).toBeGreaterThan(radius(2400));
    for (const count of [1, 2, 24, 1000, 97_000, 1_000_000, Number.MAX_SAFE_INTEGER]) {
      expect(radius(count)).toBeGreaterThanOrEqual(6);
      expect(radius(count)).toBeLessThanOrEqual(12);
      expect(Number.isFinite(radius(count))).toBe(true);
    }
  });

  it('supports a configured finite range without an abrupt count cutoff', () => {
    const mapping = resolveGroupSize({ minimumSize: 8, areaPerNode: 2, maximumSize: 20 });
    expect(groupSizeForCount(1, mapping)).toBe(8);
    expect(groupSizeForCount(20, mapping)).toBeGreaterThan(8);
    expect(groupSizeForCount(10_000, mapping)).toBeGreaterThan(19);
    expect(groupSizeForCount(10_000, mapping)).toBeLessThan(20);
    expect(groupSizeForCount(1_000_000, mapping)).toBeGreaterThan(groupSizeForCount(10_000, mapping));
    expect(groupSizeForCount(10_000, resolveGroupSize({ minimumSize: 8, maximumSize: 8 }))).toBe(8);
  });

  it('validates and copies caller-owned configuration', () => {
    for (const options of [{ minimumSize: 0 }, { areaPerNode: -1 }, { maximumSize: 4 }, { maximumSize: Infinity }])
      expect(() => copyVisualMapping({ groupSize: options })).toThrow(RangeError);
    const groupSize = { minimumSize: 8, areaPerNode: 2 };
    const retained = copyVisualMapping({ groupSize });
    groupSize.minimumSize = 10;
    expect(retained.groupSize?.minimumSize).toBe(8);
    expect(Object.isFrozen(retained.groupSize)).toBe(true);
  });
});
