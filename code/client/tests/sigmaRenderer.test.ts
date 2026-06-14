let lastSigmaOptions: Record<string, unknown> | null = null;
let lastGraph:
  | {
      getNodeAttribute: (node: string, attribute: string) => unknown;
      getEdgeAttribute: (edge: string, attribute: string) => unknown;
    }
  | null = null;
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
let pieProgramInputs: Array<{
  slices: Array<{ color: { value: string }; value: { attribute: string } }>;
}> = [];

vi.mock("@sigma/node-piechart", () => ({
  createNodePiechartProgram: (input: {
    slices: Array<{ color: { value: string }; value: { attribute: string } }>;
  }) => {
    pieProgramInputs.push(input);
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
      graph?: {
        getNodeAttribute: (node: string, attribute: string) => unknown;
      },
      _container?: unknown,
      options?: Record<string, unknown>,
    ) {
      lastSigmaOptions = options ?? null;
      lastGraph = graph ?? null;
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
import {
  MAX_PIE_SLICE_KEYS,
  PIE_ATTRIBUTE_PREFIX,
  PIE_OTHER_SLICE_KEY,
} from "../src/render/pieMapping";

const CONTAINER_ID = "graph-root";

describe("sigmaRenderer", () => {
  beforeEach(() => {
    shouldThrowOnPieProgram = false;
    pieProgramInputs = [];
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

  it("registers node programs for selected nodes and expandable cluster proxies", () => {
    document.body.innerHTML = `<div id="${CONTAINER_ID}" style="width:300px;height:200px"></div>`;

    const renderer = new SigmaRenderer();
    renderer.mount({ containerId: CONTAINER_ID });

    const nodeProgramClasses = lastSigmaOptions?.[
      "nodeProgramClasses"
    ] as Record<string, unknown> | undefined;

    expect(nodeProgramClasses).toBeDefined();
    expect(nodeProgramClasses?.["border"]).toBeDefined();
    expect(nodeProgramClasses?.["triangle"]).toBeDefined();

    renderer.unmount();
  });

  it("uses centered node labels and hides generated internal node ids", () => {
    document.body.innerHTML = `<div id="${CONTAINER_ID}" style="width:300px;height:200px"></div>`;

    const renderer = new SigmaRenderer();
    renderer.mount({ containerId: CONTAINER_ID });
    renderer.render({
      nodes: [
        { id: "internal_1", x: 0, y: 0 },
        { id: "profile_1", x: 1, y: 1 },
      ],
      edges: [],
      viewMeta: { layout: "force", lodLevel: 0 },
    });

    expect(lastSigmaOptions?.defaultDrawNodeLabel).toBeTypeOf("function");
    expect(lastGraph?.getNodeAttribute("internal_1", "label")).toBe("");
    expect(lastGraph?.getNodeAttribute("profile_1", "label")).toBe("profile_1");

    renderer.unmount();
  });

  it("renders edge distance labels and distance-weighted edge sizes", () => {
    document.body.innerHTML = `<div id="${CONTAINER_ID}" style="width:300px;height:200px"></div>`;

    const renderer = new SigmaRenderer({
      display: {
        edgeDistanceLabels: true,
        distanceWeightedEdges: true,
      },
    });
    renderer.mount({ containerId: CONTAINER_ID });
    renderer.render({
      nodes: [
        { id: "root", x: 0, y: 0 },
        { id: "a", x: 80, y: 100 },
      ],
      edges: [
        {
          id: "e_root_a_1",
          source: "root",
          target: "a",
          attributes: { distance: 2.5 },
        },
      ],
      viewMeta: { layout: "force", lodLevel: 0 },
    });

    expect(lastSigmaOptions?.renderEdgeLabels).toBe(true);
    expect(lastGraph?.getEdgeAttribute("e_root_a_1", "label")).toBe("2.500");
    expect(lastGraph?.getEdgeAttribute("e_root_a_1", "forceLabel")).toBe(true);
    expect(lastGraph?.getEdgeAttribute("e_root_a_1", "size")).toBeGreaterThan(
      1.25,
    );

    renderer.unmount();
  });

  it("updates display options without remounting the workbench", () => {
    document.body.innerHTML = `<div id="${CONTAINER_ID}" style="width:300px;height:200px"></div>`;

    const renderer = new SigmaRenderer();
    renderer.mount({ containerId: CONTAINER_ID });
    renderer.render({
      nodes: [
        { id: "root", x: 0, y: 0 },
        { id: "a", x: 80, y: 100 },
      ],
      edges: [
        {
          id: "e_root_a_1",
          source: "root",
          target: "a",
          attributes: { distance: 3 },
        },
      ],
      viewMeta: { layout: "force", lodLevel: 0 },
    });

    renderer.updateDisplayOptions({
      edgeDistanceLabels: true,
      distanceWeightedEdges: true,
    });
    renderer.render({
      nodes: [
        { id: "root", x: 0, y: 0 },
        { id: "a", x: 80, y: 100 },
      ],
      edges: [
        {
          id: "e_root_a_1",
          source: "root",
          target: "a",
          attributes: { distance: 3 },
        },
      ],
      viewMeta: { layout: "force", lodLevel: 0 },
    });

    expect(lastSigmaOptions?.renderEdgeLabels).toBe(true);
    expect(lastGraph?.getEdgeAttribute("e_root_a_1", "label")).toBe("3");

    renderer.unmount();
  });

  it("applies PHYLOViZ node and goeBURST edge color conventions", () => {
    document.body.innerHTML = `<div id="${CONTAINER_ID}" style="width:300px;height:200px"></div>`;

    const renderer = new SigmaRenderer();
    renderer.mount({ containerId: CONTAINER_ID });
    renderer.render({
      nodes: [
        {
          id: "founder",
          x: 0,
          y: 0,
          attributes: { metadata: { st_role: "group founder" } },
        },
        {
          id: "subfounder",
          x: 80,
          y: 100,
          attributes: { subgroup_founder: true },
        },
        { id: "common", x: 160, y: 100 },
        { id: "selected", x: 240, y: 100, attributes: { selected: true } },
      ],
      edges: [
        {
          id: "rule_1",
          source: "founder",
          target: "subfounder",
          attributes: { tie_break_rule: 1 },
        },
        {
          id: "rule_3",
          source: "subfounder",
          target: "common",
          attributes: { tiebreak_rule: "rule 3" },
        },
        {
          id: "tlv",
          source: "common",
          target: "selected",
          attributes: { level: "TLV" },
        },
      ],
      viewMeta: { layout: "force", lodLevel: 0 },
    });

    expect(lastGraph?.getNodeAttribute("founder", "color")).toBe("#86efac");
    expect(lastGraph?.getNodeAttribute("subfounder", "color")).toBe("#15803d");
    expect(lastGraph?.getNodeAttribute("common", "color")).toBe("#93c5fd");
    expect(lastGraph?.getNodeAttribute("selected", "color")).toBe("#dc2626");
    expect(lastGraph?.getEdgeAttribute("rule_1", "color")).toBe("#2563eb");
    expect(lastGraph?.getEdgeAttribute("rule_3", "color")).toBe("#dc2626");
    expect(lastGraph?.getEdgeAttribute("tlv", "color")).toBe("#d1d5db");

    renderer.unmount();
  });

  it("marks focused search nodes as PHYLOViZ selected nodes", () => {
    document.body.innerHTML = `<div id="${CONTAINER_ID}" style="width:300px;height:200px"></div>`;

    const renderer = new SigmaRenderer({
      display: {
        nodeLabels: false,
      },
    });
    renderer.mount({ containerId: CONTAINER_ID });
    renderer.render({
      nodes: [
        { id: "target", x: 0, y: 0, size: 6 },
        { id: "nearby", x: 2, y: 1, size: 6 },
      ],
      edges: [],
      viewMeta: { layout: "force", lodLevel: 0 },
    });

    renderer.focusNode("target");

    expect(lastGraph?.getNodeAttribute("target", "type")).toBe("border");
    expect(lastGraph?.getNodeAttribute("target", "color")).toBe("#dc2626");
    expect(lastGraph?.getNodeAttribute("target", "borderColor")).toBe(
      "#ffffff",
    );
    expect(lastGraph?.getNodeAttribute("target", "forceLabel")).toBe(true);
    expect(lastGraph?.getNodeAttribute("target", "label")).toBe("target");
    expect(lastGraph?.getNodeAttribute("target", "size")).toBeGreaterThan(6);
    expect(lastGraph?.getNodeAttribute("nearby", "type")).toBe("circle");

    renderer.unmount();
  });

  it("uses darker Full MST grayscale links for lower distances", () => {
    document.body.innerHTML = `<div id="${CONTAINER_ID}" style="width:300px;height:200px"></div>`;

    const renderer = new SigmaRenderer();
    renderer.mount({ containerId: CONTAINER_ID });
    renderer.render({
      nodes: [
        { id: "a", x: 0, y: 0 },
        { id: "b", x: 80, y: 0 },
        { id: "c", x: 160, y: 0 },
      ],
      edges: [
        {
          id: "near",
          source: "a",
          target: "b",
          attributes: { distance: 1 },
        },
        {
          id: "far",
          source: "b",
          target: "c",
          attributes: { distance: 5 },
        },
      ],
      viewMeta: { layout: "force", lodLevel: 0 },
    });

    expect(lastGraph?.getEdgeAttribute("near", "color")).toBe("#232323");
    expect(lastGraph?.getEdgeAttribute("far", "color")).toBe("#dcdcdc");

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

  it("falls back to default nodes if pie-program rebuild fails", () => {
    document.body.innerHTML = `<div id="${CONTAINER_ID}" style="width:300px;height:200px"></div>`;

    const renderer = new SigmaRenderer();
    renderer.mount({ containerId: CONTAINER_ID });
    renderer.render({
      nodes: [{ id: "a", x: 0, y: 0 }],
      edges: [],
      viewMeta: { layout: "force", lodLevel: 0 },
    });

    shouldThrowOnPieProgram = true;
    expect(() => {
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
      });
    }).not.toThrow();
    expect(lastGraph?.getNodeAttribute("a", "type")).toBe("circle");

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

  it("rebuilds pie programs when category colors change", () => {
    document.body.innerHTML = `<div id="${CONTAINER_ID}" style="width:300px;height:200px"></div>`;

    const renderer = new SigmaRenderer();
    renderer.mount({ containerId: CONTAINER_ID });
    renderer.render({
      nodes: [
        {
          id: "a",
          x: 0,
          y: 0,
          attributes: {
            pie__country__value__portugal: 1,
            __pie_category_colors: {
              pie__country__value__portugal: "#123456",
            },
          },
        },
      ],
      edges: [],
      viewMeta: { layout: "force", lodLevel: 0 },
    });
    renderer.render({
      nodes: [
        {
          id: "a",
          x: 0,
          y: 0,
          attributes: {
            pie__country__value__portugal: 1,
            __pie_category_colors: {
              pie__country__value__portugal: "#abcdef",
            },
          },
        },
      ],
      edges: [],
      viewMeta: { layout: "force", lodLevel: 0 },
    });

    expect(pieProgramInputs).toHaveLength(2);
    expect(pieProgramInputs[0]?.slices[0]?.color.value).toBe("#123456");
    expect(pieProgramInputs[1]?.slices[0]?.color.value).toBe("#abcdef");

    renderer.unmount();
  });

  it("renders omitted high-cardinality pie values through Others", () => {
    document.body.innerHTML = `<div id="${CONTAINER_ID}" style="width:300px;height:200px"></div>`;

    const renderer = new SigmaRenderer();
    renderer.mount({ containerId: CONTAINER_ID });
    renderer.render({
      nodes: Array.from({ length: MAX_PIE_SLICE_KEYS + 2 }, (_, index) => ({
        id: `node_${index}`,
        x: index,
        y: index,
        attributes: {
          [`${PIE_ATTRIBUTE_PREFIX}country_${index}`]: index + 1,
        },
      })),
      edges: [],
      viewMeta: { layout: "force", lodLevel: 0 },
    });

    expect(lastGraph?.getNodeAttribute("node_0", PIE_OTHER_SLICE_KEY)).toBe(1);
    expect(lastGraph?.getNodeAttribute("node_0", "type")).toBe("piechart");

    renderer.unmount();
  });
});
