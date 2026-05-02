let lastSigmaOptions: Record<string, unknown> | null = null;

vi.mock("sigma", () => {
  class FakeSigma {
    constructor(
      _graph?: unknown,
      _container?: unknown,
      options?: Record<string, unknown>,
    ) {
      lastSigmaOptions = options ?? null;
    }

    getCamera() {
      return {
        setState: () => undefined,
      };
    }

    refresh() {
      return undefined;
    }

    kill() {
      return undefined;
    }
  }

  return { default: FakeSigma };
});

import {
  ERR_CONTAINER_NOT_FOUND,
  SIGMA_MAX_LOD_ZOOM,
  SigmaRenderer,
  sigmaCameraToViewportState,
  sigmaRatioToLodZoom,
} from "../src/render/adapters/sigmaRenderer";

const CONTAINER_ID = "graph-root";

describe("sigmaRenderer", () => {
  it("throws when mounting with a missing container", () => {
    const renderer = new SigmaRenderer();

    expect(() => renderer.mount({ containerId: CONTAINER_ID })).toThrow(
      ERR_CONTAINER_NOT_FOUND.replace("{containerId}", CONTAINER_ID),
    );
  });

  it("mounts, renders, and unmounts with a valid container", () => {
    document.body.innerHTML = `<div id="${CONTAINER_ID}" style="width:300px;height:200px"></div>`;

    const renderer = new SigmaRenderer();

    renderer.mount({ containerId: CONTAINER_ID });
    renderer.render({
      nodes: [
        { id: "root", x: 0, y: 0 },
        { id: "a", x: 80, y: 100 },
      ],
      edges: [{ id: "e_root_a_1", source: "root", target: "a" }],
      viewMeta: { layout: "force", lodLevel: 0 },
    });

    renderer.unmount();
  });

  it("registers a triangle node program for expandable cluster proxies", () => {
    document.body.innerHTML = `<div id="${CONTAINER_ID}" style="width:300px;height:200px"></div>`;

    const renderer = new SigmaRenderer();
    renderer.mount({ containerId: CONTAINER_ID });

    const nodeProgramClasses = lastSigmaOptions?.[
      "nodeProgramClasses"
    ] as Record<string, unknown> | undefined;

    expect(nodeProgramClasses).toBeDefined();
    expect(nodeProgramClasses?.["triangle"]).toBeDefined();

    renderer.unmount();
  });

  it("maps deeper camera zoom to progressively higher lod zoom values", () => {
    expect(sigmaRatioToLodZoom(2)).toBe(0.5);
    expect(sigmaRatioToLodZoom(1)).toBe(1);
    expect(sigmaRatioToLodZoom(0.5)).toBe(2);
    expect(sigmaRatioToLodZoom(0.25)).toBe(3);
    expect(sigmaRatioToLodZoom(0.125)).toBe(4);
    expect(sigmaRatioToLodZoom(0.05)).toBeGreaterThanOrEqual(5);
    expect(sigmaRatioToLodZoom(0.002)).toBe(SIGMA_MAX_LOD_ZOOM);
  });

  it("translates sigma camera state into graph-space viewport bounds", () => {
    expect(
      sigmaCameraToViewportState(
        { minX: -120, maxX: 280, minY: 0, maxY: 300 },
        { x: 0.25, y: 0.5, ratio: 0.5 },
      ),
    ).toEqual({
      x: -20,
      y: 150,
      width: 200,
      height: 150,
    });
  });
});
