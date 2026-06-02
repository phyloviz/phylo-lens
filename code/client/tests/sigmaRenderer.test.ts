let lastSigmaOptions: Record<string, unknown> | null = null;
let lastCustomBBox:
  | {
      x: [number, number];
      y: [number, number];
    }
  | null = null;
let lastCamera:
  | {
      state: { x?: number; y?: number; ratio?: number };
      handler: (() => void) | null;
      setState: (state: { x?: number; y?: number; ratio?: number }) => void;
      getState: () => { x?: number; y?: number; ratio?: number };
      on: (event: string, handler: () => void) => void;
      off: (event: string, handler: () => void) => void;
    }
  | null = null;
let shouldThrowOnPieProgram = false;

vi.mock("@sigma/node-piechart", () => ({
  createNodePiechartProgram: () => {
    if (shouldThrowOnPieProgram) {
      throw new Error("pie program failed");
    }
    return class FakePiechartProgram {};
  },
}));

vi.mock("sigma", () => {
  class FakeSigma {
    private readonly camera = {
      state: { ratio: 1 } as { x?: number; y?: number; ratio?: number },
      handler: null as (() => void) | null,
      setState: (state: { x?: number; y?: number; ratio?: number }) => {
        this.camera.state = { ...this.camera.state, ...state };
      },
      getState: () => this.camera.state,
      on: (event: string, handler: () => void) => {
        if (event === "updated") {
          this.camera.handler = handler;
        }
      },
      off: (event: string, handler: () => void) => {
        if (event === "updated" && this.camera.handler === handler) {
          this.camera.handler = null;
        }
      },
    };

    constructor(
      _graph?: unknown,
      _container?: unknown,
      options?: Record<string, unknown>,
    ) {
      lastSigmaOptions = options ?? null;
      lastCamera = this.camera;
    }

    getCamera() {
      return this.camera;
    }

    refresh() {
      return undefined;
    }

    setCustomBBox(
      bounds: { x: [number, number]; y: [number, number] } | null,
    ) {
      lastCustomBBox = bounds;
      return this;
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
} from "../src/render/adapters/sigma/sigmaRenderer";

const CONTAINER_ID = "graph-root";

describe("sigmaRenderer", () => {
  beforeEach(() => {
    shouldThrowOnPieProgram = false;
  });

  beforeEach(() => {
    shouldThrowOnPieProgram = false;
  });

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

  it("emits camera viewports in global graph bounds when a slice provides them", () => {
    document.body.innerHTML = `<div id="${CONTAINER_ID}" style="width:300px;height:200px"></div>`;

    const renderer = new SigmaRenderer();
    const handler = vi.fn();
    renderer.mount({ containerId: CONTAINER_ID });
    renderer.setViewChangeHandler(handler);
    renderer.render({
      nodes: [
        { id: "left", x: -10, y: 0 },
        { id: "nearby", x: 10, y: 0 },
      ],
      edges: [],
      viewMeta: {
        layout: "server",
        lodLevel: 1,
        globalBounds: { minX: -1000, maxX: 1000, minY: -500, maxY: 500 },
      },
    });

    lastCamera?.setState({ x: 0.25, y: 0.5, ratio: 0.25 });
    lastCamera?.handler?.();

    expect(handler).toHaveBeenCalledWith({
      viewport: {
        x: -500,
        y: 0,
        width: 500,
        height: 250,
      },
      zoom: 3,
    });
    expect(lastCustomBBox).toEqual({
      x: [-1000, 1000],
      y: [-500, 500],
    });

    renderer.unmount();
  });

  it("keeps the existing Sigma instance if pie-program rebuild fails", () => {
    document.body.innerHTML = `<div id="${CONTAINER_ID}" style="width:300px;height:200px"></div>`;

    const renderer = new SigmaRenderer();
    renderer.mount({ containerId: CONTAINER_ID });
    renderer.render({
      nodes: [{ id: "a", x: 0, y: 0 }],
      edges: [],
      viewMeta: { layout: "force", lodLevel: 0 },
    });

    shouldThrowOnPieProgram = true;
    expect(() =>
      renderer.render({
        nodes: [
          {
            id: "a",
            x: 0,
            y: 0,
            attributes: { pie__country__value__canada: 1 },
          },
        ],
        edges: [],
        viewMeta: { layout: "force", lodLevel: 0 },
      }),
    ).toThrow("pie program failed");

    shouldThrowOnPieProgram = false;
    expect(() =>
      renderer.render({
        nodes: [{ id: "a", x: 0, y: 0 }],
        edges: [],
        viewMeta: { layout: "force", lodLevel: 0 },
      }),
    ).not.toThrow();

    renderer.unmount();
  });
});
