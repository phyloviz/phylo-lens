import { describe, expect, it } from "vitest";

import rendererFactory from "../src/render/rendererFactory";
import { RENDERER_KIND_MOCK, RENDERER_KIND_SIGMA } from "../src/render/types";

describe("rendererFactory", () => {
  it("creates the sigma renderer adapter", () => {
    const factory = rendererFactory();
    const renderer = factory.createRenderer(RENDERER_KIND_SIGMA);

    expect(renderer.kind).toBe(RENDERER_KIND_SIGMA);
  });

  it("creates the mock renderer adapter", () => {
    const factory = rendererFactory();
    const renderer = factory.createRenderer(RENDERER_KIND_MOCK);

    expect(renderer.kind).toBe(RENDERER_KIND_MOCK);
  });
});
