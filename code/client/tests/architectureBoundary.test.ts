import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function source(path: string): string {
  return readFileSync(resolve(repoRoot, path), "utf8");
}

describe("client architecture boundary", () => {
  it("keeps transport and viewport sync ownership out of the renderer contract", () => {
    const rendererTypes = source("src/render/renderer.types.ts");

    expect(rendererTypes).not.toContain("GraphClient");
    expect(rendererTypes).not.toContain("GraphViewportResponse");
    expect(rendererTypes).not.toContain("ViewportSyncSettings");
    expect(rendererTypes).not.toContain("startGraphViewportSync");
    expect(rendererTypes).not.toContain("refreshGraphViewportSync");
    expect(rendererTypes).not.toContain("stopGraphViewportSync");
  });

  it("keeps SigmaRenderer free of server viewport sync controllers", () => {
    const sigmaRenderer = source("src/render/adapters/sigma/sigmaRenderer.ts");

    expect(sigmaRenderer).not.toContain("GraphViewportController");
    expect(sigmaRenderer).not.toContain("ViewportSyncController");
    expect(sigmaRenderer).not.toContain("GraphClient");
    expect(sigmaRenderer).not.toContain("readViewport");
  });
});
