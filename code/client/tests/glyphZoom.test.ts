import { describe, it, expect } from "vitest";
import { zoomToGlyphSizeRatio } from "../src/render/adapters/sigma/sigmaRenderer.settings";
describe("glyph zoom scaling", () => {
  it("shrinks glyphs in proportion to positions on zoom-out", () => {
    expect(8 / zoomToGlyphSizeRatio(4)).toBe(2);
    expect(8 / zoomToGlyphSizeRatio(1)).toBe(8);
  });
  it("moderates deep zoom glyph growth", () => {
    expect(8 / zoomToGlyphSizeRatio(0.25)).toBe(12);
    expect(8 / zoomToGlyphSizeRatio(1 / 51.22)).toBe(12);
    expect(8 / zoomToGlyphSizeRatio(1 / 10000)).toBe(12);
  });
});
