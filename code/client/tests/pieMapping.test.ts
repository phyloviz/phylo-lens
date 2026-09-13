import { describe, expect, it } from "vitest";

import {
  buildPiePalette,
  detectPieSliceKeys,
  MAX_PIE_SLICE_KEYS,
  PIE_ATTRIBUTE_PREFIX,
  PIE_OTHER_SLICE_KEY,
} from "../src/render/mapping/pieMapping";

describe("pieMapping", () => {
  it("caps detected pie slice keys and aggregates the tail as Others", () => {
    const nodes = Array.from({ length: MAX_PIE_SLICE_KEYS + 10 }, (_, index) => ({
      attributes: {
        [`${PIE_ATTRIBUTE_PREFIX}country_${index}`]: index + 1,
      },
    }));

    const keys = detectPieSliceKeys(nodes);

    expect(keys).toHaveLength(MAX_PIE_SLICE_KEYS);
    expect(keys).toContain(`${PIE_ATTRIBUTE_PREFIX}country_${MAX_PIE_SLICE_KEYS + 9}`);
    expect(keys).toContain(PIE_OTHER_SLICE_KEY);
    expect(keys.filter((key) => key !== PIE_OTHER_SLICE_KEY)).toHaveLength(MAX_PIE_SLICE_KEYS - 1);
    expect(keys).not.toContain(`${PIE_ATTRIBUTE_PREFIX}country_0`);
  });

  it("generates hex colors for pie palettes beyond the seed colors", () => {
    const palette = buildPiePalette(12);

    expect(palette).toHaveLength(12);
    expect(palette.every((color) => /^#[0-9a-fA-F]{6}$/.test(color))).toBe(true);
  });
});
