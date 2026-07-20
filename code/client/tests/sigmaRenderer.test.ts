import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let lastSigmaOptions: Record<string, unknown> | null = null;
let lastGraph: {
  getNodeAttribute: (node: string, attribute: string) => unknown;
  getEdgeAttribute: (edge: string, attribute: string) => unknown;
  setNodeAttribute: (node: string, attribute: string, value: unknown) => void;
} | null = null;
let lastCustomBBox: {
  x: [number, number];
  y: [number, number];
} | null = null;
let lastCamera: {
  state: { x?: number; y?: number; ratio?: number };
  handler: (() => void) | null;
  setState: (state: { x?: number; y?: number; ratio?: number }) => void;
  getState: () => { x?: number; y?: number; ratio?: number };
  on: (event: string, handler: () => void) => void;
  off: (event: string, handler: () => void) => void;
} | null = null;
let lastStageClickHandler: (() => void) | null = null;
let lastNodeClickHandler: ((payload: { node?: string; event?: { node?: string } }) => void) | null = null;
let lastNodeDoubleClickHandler: ((payload: { node?: string; event?: { node?: string } }) => void) | null = null;
let shouldThrowOnPieProgram = false;
let pieProgramInputs: Array<{
  slices: Array<{ color: { value: string }; value: { attribute: string } }>;
}> = [];
let forceMotionStarts = 0;
let forceMotionKills = 0;
let sigmaConstructions = 0;
let lastForceMotionSettings: Record<string, number> | null = null;
let animationFrameCallback: FrameRequestCallback | null = null;
let animationFrameId = 0;
let graphToViewportPoint = (point: { x: number; y: number }) => point;
let viewportToFramedGraphPoint = (point: { x: number; y: number }) => point;

vi.mock("graphology-layout-forceatlas2/worker.js", () => ({
  default: class FakeForceSupervisor {
    constructor(_graph: unknown, options?: { settings?: Record<string, number> }) {
      lastForceMotionSettings = options?.settings ?? null;
    }

    start() {
      forceMotionStarts += 1;
    }

    kill() {
      forceMotionKills += 1;
    }
  },
}));

vi.mock("@sigma/node-piechart", () => ({
  createNodePiechartProgram: (input: { slices: Array<{ color: { value: string }; value: { attribute: string } }> }) => {
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
      sigmaConstructions += 1;
    }

    on(event: string, handler: (payload?: { node?: string; event?: { node?: string } }) => void) {
      if (event === "clickStage") {
        lastStageClickHandler = handler as () => void;
      }
      if (event === "clickNode") {
        lastNodeClickHandler = handler;
      }
      if (event === "doubleClickNode") {
        lastNodeDoubleClickHandler = handler;
      }
      return this;
    }

    off(event: string, handler: (payload?: { node?: string; event?: { node?: string } }) => void) {
      if (event === "clickStage" && lastStageClickHandler === handler) {
        lastStageClickHandler = null;
      }
      if (event === "clickNode" && lastNodeClickHandler === handler) {
        lastNodeClickHandler = null;
      }
      if (event === "doubleClickNode" && lastNodeDoubleClickHandler === handler) {
        lastNodeDoubleClickHandler = null;
      }
      return this;
    }

    getCamera() {
      return this.camera;
    }

    refresh() {
      return undefined;
    }

    getSetting(key: string) {
      return lastSigmaOptions?.[key];
    }

    setSetting(key: string, value: unknown) {
      if (lastSigmaOptions) {
        lastSigmaOptions[key] = value;
      }
      return this;
    }

    scheduleRender() {
      return this;
    }

    graphToViewport(point: { x: number; y: number }) {
      return graphToViewportPoint(point);
    }

    viewportToFramedGraph(point: { x: number; y: number }) {
      return viewportToFramedGraphPoint(point);
    }

    viewportToGraph(point: { x: number; y: number }) {
      return point;
    }

    getDimensions() {
      return { width: 300, height: 200 };
    }

    setCustomBBox(bounds: { x: [number, number]; y: [number, number] } | null) {
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
  SIGMA_MAX_LOD_ZOOM,
  SigmaRenderer,
  sigmaCameraToViewportState,
  sigmaCameraToSemanticViewState,
  sigmaRatioToLodZoom,
} from "../src/render/adapters/sigma/sigmaRenderer";
import { MAX_PIE_SLICE_KEYS, PIE_ATTRIBUTE_PREFIX, PIE_OTHER_SLICE_KEY } from "../src/render/mapping/pieMapping";
import Graph from "graphology";
import { applyPieChartNodeTypes } from "../src/render/adapters/sigma/attributes/sigmaNodeAttributes";
import {
  PHYLOVIZ_NODE_SELECTED_COLOR,
  SIGMA_NODE_TYPE_PIECHART,
} from "../src/render/adapters/sigma/sigmaRendering.constants";

const CONTAINER_ID = "graph-root";

function requireContainer(): HTMLElement {
  const container = document.getElementById(CONTAINER_ID);
  if (!container) {
    throw new Error(`Missing test container: ${CONTAINER_ID}`);
  }
  return container;
}

describe("sigmaRenderer", () => {
  beforeEach(() => {
    shouldThrowOnPieProgram = false;
    pieProgramInputs = [];
    forceMotionStarts = 0;
    forceMotionKills = 0;
    sigmaConstructions = 0;
    lastForceMotionSettings = null;
    lastStageClickHandler = null;
    lastNodeClickHandler = null;
    lastNodeDoubleClickHandler = null;
    animationFrameCallback = null;
    animationFrameId = 0;
    graphToViewportPoint = (point) => point;
    viewportToFramedGraphPoint = (point) => point;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      animationFrameCallback = callback;
      animationFrameId += 1;
      return animationFrameId;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {
      animationFrameCallback = null;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("mounts, renders, and unmounts with a valid container", () => {
    document.body.innerHTML = `<div id="${CONTAINER_ID}" style="width:300px;height:200px"></div>`;

    const renderer = new SigmaRenderer();

    renderer.mount({ container: requireContainer() });
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

  it("exposes renderer-neutral viewport sync state", () => {
    document.body.innerHTML = `<div id="${CONTAINER_ID}" style="width:300px;height:200px"></div>`;

    const renderer = new SigmaRenderer();
    renderer.mount({ container: requireContainer() });
    lastCamera?.setState({ ratio: 2 });

    expect(renderer.getViewportSyncState()).toEqual({
      bounds: { xmin: 0, xmax: 300, ymin: 0, ymax: 200 },
      cameraRatio: 2,
    });

    renderer.unmount();
  });

  it("emits separate node click and double-click callbacks", () => {
    document.body.innerHTML = `<div id="${CONTAINER_ID}" style="width:300px;height:200px"></div>`;

    const renderer = new SigmaRenderer();
    const clickHandler = vi.fn();
    const doubleClickHandler = vi.fn();
    renderer.mount({ container: requireContainer() });
    renderer.render({
      nodes: [{ id: "cluster-a", x: 0, y: 0, attributes: { cluster_id: "cluster-a" } }],
      edges: [],
      viewMeta: { layout: "server", lodLevel: 0 },
    });
    renderer.setNodeClickHandler(clickHandler);
    renderer.setNodeDoubleClickHandler(doubleClickHandler);

    lastNodeClickHandler?.({ node: "cluster-a" });
    lastNodeDoubleClickHandler?.({ node: "cluster-a" });

    expect(clickHandler).toHaveBeenCalledWith({
      nodeId: "cluster-a",
      attributes: expect.objectContaining({ cluster_id: "cluster-a" }),
    });
    expect(doubleClickHandler).toHaveBeenCalledWith({
      nodeId: "cluster-a",
      attributes: expect.objectContaining({ cluster_id: "cluster-a" }),
    });

    renderer.unmount();
  });

  it("keeps camera and node handlers bound after Sigma is rebuilt for pie programs", () => {
    document.body.innerHTML = `<div id="${CONTAINER_ID}" style="width:300px;height:200px"></div>`;

    const renderer = new SigmaRenderer();
    const viewHandler = vi.fn();
    const clickHandler = vi.fn();
    renderer.mount({ container: requireContainer() });
    renderer.setViewChangeHandler(viewHandler);
    renderer.setNodeClickHandler(clickHandler);

    renderer.render({
      nodes: [
        {
          id: "a",
          x: 0,
          y: 0,
          attributes: { pie__country__value__portugal: 1 },
        },
      ],
      edges: [],
      viewMeta: { layout: "server", lodLevel: 0 },
    });

    lastCamera?.handler?.();
    lastNodeClickHandler?.({ node: "a" });

    expect(viewHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        viewport: expect.any(Object),
        zoom: expect.any(Number),
      }),
    );
    expect(clickHandler).toHaveBeenCalledWith({
      nodeId: "a",
      attributes: expect.objectContaining({ pie__country__value__portugal: 1 }),
    });

    renderer.unmount();
  });

  it("dims non-highlighted nodes/edges via reducers and clears them", () => {
    document.body.innerHTML = `<div id="${CONTAINER_ID}" style="width:300px;height:200px"></div>`;

    const renderer = new SigmaRenderer();
    renderer.mount({ container: requireContainer() });
    renderer.render({
      nodes: [
        { id: "a", x: 0, y: 0 },
        { id: "b", x: 10, y: 10 },
        { id: "c", x: 20, y: 20 },
      ],
      edges: [
        { id: "e_a_b", source: "a", target: "b" },
        { id: "e_b_c", source: "b", target: "c" },
      ],
      viewMeta: { layout: "server", lodLevel: 0 },
    });

    renderer.setHighlightedNodes(new Set(["a", "b"]));

    const nodeReducer = lastSigmaOptions?.nodeReducer as
      ((id: string, data: Record<string, unknown>) => Record<string, unknown>) | undefined;
    const edgeReducer = lastSigmaOptions?.edgeReducer as
      ((id: string, data: Record<string, unknown>) => Record<string, unknown>) | undefined;
    expect(typeof nodeReducer).toBe("function");
    // Highlighted node is untouched; outside node is dimmed and delabeled.
    expect(nodeReducer?.("a", { color: "#111", label: "a" })).toMatchObject({
      color: "#111",
      label: "a",
    });
    expect(nodeReducer?.("c", { color: "#111", label: "c" })).toMatchObject({
      color: "#cbd5e1",
      label: "",
    });
    // Internal edge stays; boundary edge (b-c) is dimmed.
    expect(edgeReducer?.("e_a_b", { color: "#111" })).toMatchObject({
      color: "#111",
    });
    expect(edgeReducer?.("e_b_c", { color: "#111" })).toMatchObject({
      color: "#e2e8f0",
    });

    // Clearing removes the reducers.
    renderer.setHighlightedNodes(null);
    expect(lastSigmaOptions?.nodeReducer).toBeNull();
    expect(lastSigmaOptions?.edgeReducer).toBeNull();

    renderer.unmount();
  });

  it("runs live force motion for complete client layouts only", () => {
    document.body.innerHTML = `<div id="${CONTAINER_ID}" style="width:300px;height:200px"></div>`;

    const renderer = new SigmaRenderer({ forceMotion: { durationMs: 0 } });
    renderer.mount({ container: requireContainer() });
    renderer.render({
      nodes: [
        { id: "root", x: 0, y: 0 },
        { id: "a", x: 80, y: 100 },
      ],
      edges: [{ id: "e_root_a_1", source: "root", target: "a" }],
      viewMeta: { layout: "force", lodLevel: 0 },
    });

    expect(forceMotionStarts).toBe(1);

    renderer.render({
      nodes: [
        { id: "root", x: 0, y: 0 },
        { id: "a", x: 80, y: 100 },
      ],
      edges: [{ id: "e_root_a_1", source: "root", target: "a" }],
      viewMeta: { layout: "server", lodLevel: 0 },
    });

    expect(forceMotionStarts).toBe(1);
    expect(forceMotionKills).toBe(1);
    expect(lastForceMotionSettings).toMatchObject({
      adjustSizes: false,
      barnesHutOptimize: true,
      strongGravityMode: false,
      gravity: 0.02,
      scalingRatio: 18,
      slowDown: 10,
    });

    renderer.unmount();
  });

  it("allows scale-aware force settings to be overridden", () => {
    document.body.innerHTML = `<div id="${CONTAINER_ID}" style="width:300px;height:200px"></div>`;

    const renderer = new SigmaRenderer({
      forceMotion: {
        durationMs: 0,
        settings: { gravity: 0.5, scalingRatio: 24 },
      },
    });
    renderer.mount({ container: requireContainer() });
    renderer.render({
      nodes: [
        { id: "root", x: 0, y: 0 },
        { id: "a", x: 80, y: 100 },
      ],
      edges: [{ id: "e_root_a_1", source: "root", target: "a" }],
      viewMeta: { layout: "force", lodLevel: 0 },
    });

    expect(lastForceMotionSettings).toMatchObject({
      gravity: 0.5,
      scalingRatio: 24,
      slowDown: 10,
    });

    renderer.unmount();
  });

  it("can disable live force motion", () => {
    document.body.innerHTML = `<div id="${CONTAINER_ID}" style="width:300px;height:200px"></div>`;

    const renderer = new SigmaRenderer({ forceMotion: { enabled: false } });
    renderer.mount({ container: requireContainer() });
    renderer.render({
      nodes: [
        { id: "root", x: 0, y: 0 },
        { id: "a", x: 80, y: 100 },
      ],
      edges: [{ id: "e_root_a_1", source: "root", target: "a" }],
      viewMeta: { layout: "force", lodLevel: 0 },
    });

    expect(forceMotionStarts).toBe(0);

    renderer.unmount();
  });

  it("registers node programs for selected nodes and expandable cluster proxies", () => {
    document.body.innerHTML = `<div id="${CONTAINER_ID}" style="width:300px;height:200px"></div>`;

    const renderer = new SigmaRenderer();
    renderer.mount({ container: requireContainer() });

    const nodeProgramClasses = lastSigmaOptions?.["nodeProgramClasses"] as Record<string, unknown> | undefined;

    expect(nodeProgramClasses).toBeDefined();
    expect(nodeProgramClasses?.["border"]).toBeDefined();
    expect(nodeProgramClasses?.["triangle"]).toBeDefined();

    renderer.unmount();
  });

  it("points cluster proxy triangle tips at their incident tree edges", () => {
    document.body.innerHTML = `<div id="${CONTAINER_ID}" style="width:300px;height:200px"></div>`;

    const renderer = new SigmaRenderer();
    renderer.mount({ container: requireContainer() });
    renderer.render({
      nodes: [
        { id: "root", x: 0, y: 0 },
        {
          id: "cluster",
          x: 0,
          y: 10,
          attributes: { is_cluster_proxy: true },
        },
      ],
      edges: [{ id: "root-cluster", source: "root", target: "cluster" }],
      viewMeta: { layout: "server", lodLevel: 0 },
    });

    expect(lastGraph?.getNodeAttribute("cluster", "type")).toBe("triangle");
    expect(lastGraph?.getNodeAttribute("cluster", "triangleRotation")).toBeCloseTo(-Math.PI / 2);

    renderer.unmount();
  });

  it("keeps cluster proxy triangle tips aligned while force motion moves nodes", () => {
    document.body.innerHTML = `<div id="${CONTAINER_ID}" style="width:300px;height:200px"></div>`;

    const renderer = new SigmaRenderer({ forceMotion: { durationMs: 0 } });
    renderer.mount({ container: requireContainer() });
    renderer.render({
      nodes: [
        { id: "root", x: 0, y: 0 },
        {
          id: "cluster",
          x: 0,
          y: 10,
          attributes: { is_cluster_proxy: true },
        },
      ],
      edges: [{ id: "root-cluster", source: "root", target: "cluster" }],
      viewMeta: { layout: "force", lodLevel: 0 },
    });

    lastGraph?.setNodeAttribute("root", "x", 10);
    animationFrameCallback?.(16);

    expect(lastGraph?.getNodeAttribute("cluster", "triangleRotation")).toBeCloseTo(Math.atan2(-10, 10));

    renderer.unmount();
  });

  it("uses centered node labels and hides implementation-only node ids", () => {
    document.body.innerHTML = `<div id="${CONTAINER_ID}" style="width:300px;height:200px"></div>`;

    const renderer = new SigmaRenderer();
    renderer.mount({ container: requireContainer() });
    renderer.render({
      nodes: [
        { id: "union_1", x: 0, y: 0 },
        // A real isolate whose label merely starts with the union prefix
        // must NOT be hidden — only generated `union_<digits>` ids are.
        { id: "union_sample", x: 0.75, y: 0.75 },
        // `internal_` is not a structural convention the server emits, so an
        // `internal_`-prefixed id is a real node and must render normally.
        { id: "internal_7", x: 0.5, y: 0.5 },
        { id: "profile_1", x: 1, y: 1 },
        {
          id: "cluster_proxy:threshold_cluster_4_42",
          x: 2,
          y: 2,
          attributes: {
            cluster_id: "threshold_cluster_4_42",
            is_cluster_proxy: true,
          },
        },
      ],
      edges: [],
      viewMeta: { layout: "force", lodLevel: 0 },
    });

    expect(lastSigmaOptions?.defaultDrawNodeLabel).toBeTypeOf("function");
    expect(lastGraph?.getNodeAttribute("union_1", "label")).toBe("");
    expect(lastGraph?.getNodeAttribute("union_1", "size")).toBe(0);
    expect(lastGraph?.getNodeAttribute("union_1", "color")).toBe("#ffffff");
    expect(lastGraph?.getNodeAttribute("union_sample", "label")).toBe("union_sample");
    expect(lastGraph?.getNodeAttribute("union_sample", "size")).not.toBe(0);
    expect(lastGraph?.getNodeAttribute("internal_7", "label")).toBe("internal_7");
    expect(lastGraph?.getNodeAttribute("internal_7", "size")).not.toBe(0);
    expect(lastGraph?.getNodeAttribute("profile_1", "label")).toBe("profile_1");
    expect(lastGraph?.getNodeAttribute("cluster_proxy:threshold_cluster_4_42", "label")).toBe("");

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
    renderer.mount({ container: requireContainer() });
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

    expect(lastSigmaOptions?.renderEdgeLabels).toBe(false);
    expect(lastGraph?.getEdgeAttribute("e_root_a_1", "label")).toBe("2.500");
    expect(lastGraph?.getEdgeAttribute("e_root_a_1", "forceLabel")).toBe(true);
    expect(lastGraph?.getEdgeAttribute("e_root_a_1", "size")).toBeGreaterThan(1.25);

    lastCamera?.setState({ ratio: 0.4 });
    lastCamera?.handler?.();
    expect(lastSigmaOptions?.renderEdgeLabels).toBe(true);

    lastCamera?.setState({ ratio: 1 });
    lastCamera?.handler?.();
    expect(lastSigmaOptions?.renderEdgeLabels).toBe(false);

    renderer.unmount();
  });

  it("updates display options without remounting the workbench", () => {
    document.body.innerHTML = `<div id="${CONTAINER_ID}" style="width:300px;height:200px"></div>`;

    const renderer = new SigmaRenderer();
    renderer.mount({ container: requireContainer() });
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

    expect(lastSigmaOptions?.renderEdgeLabels).toBe(false);
    expect(lastGraph?.getEdgeAttribute("e_root_a_1", "label")).toBe("3");

    renderer.unmount();
  });

  it("applies PHYLOViZ node and goeBURST edge color conventions", () => {
    document.body.innerHTML = `<div id="${CONTAINER_ID}" style="width:300px;height:200px"></div>`;

    const renderer = new SigmaRenderer();
    renderer.mount({ container: requireContainer() });
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
    expect(lastGraph?.getEdgeAttribute("tlv", "color")).toBe("#9ca3af");

    renderer.unmount();
  });

  it("marks focused search nodes as PHYLOViZ selected nodes", () => {
    document.body.innerHTML = `<div id="${CONTAINER_ID}" style="width:300px;height:200px"></div>`;

    const renderer = new SigmaRenderer({
      display: {
        nodeLabels: false,
      },
    });
    renderer.mount({ container: requireContainer() });
    renderer.render({
      nodes: [
        { id: "target", x: 0, y: 0, size: 6 },
        { id: "nearby", x: 2, y: 1, size: 6 },
      ],
      edges: [],
      viewMeta: { layout: "force", lodLevel: 0 },
    });

    renderer.focusNode("target");

    const nodeReducer = lastSigmaOptions?.nodeReducer as
      ((id: string, data: Record<string, unknown>) => Record<string, unknown>) | undefined;
    const renderedTarget = nodeReducer?.("target", {
      type: lastGraph?.getNodeAttribute("target", "type"),
      color: lastGraph?.getNodeAttribute("target", "color"),
      borderColor: lastGraph?.getNodeAttribute("target", "borderColor"),
      label: lastGraph?.getNodeAttribute("target", "label"),
      size: lastGraph?.getNodeAttribute("target", "size"),
    });

    expect(lastGraph?.getNodeAttribute("target", "type")).toBe("circle");
    expect(lastGraph?.getNodeAttribute("target", "color")).toBe("#93c5fd");
    expect(renderedTarget).toMatchObject({
      type: "border",
      color: "#dc2626",
      borderColor: "#ffffff",
      forceLabel: true,
      label: "target",
    });
    expect(renderedTarget?.size).toBeGreaterThan(6);
    expect(lastGraph?.getNodeAttribute("nearby", "type")).toBe("circle");

    renderer.unmount();
  });

  it("centers raw search coordinates through Sigma's graph conversion", () => {
    document.body.innerHTML = `<div id="${CONTAINER_ID}" style="width:300px;height:200px"></div>`;
    graphToViewportPoint = (point) => ({
      x: point.x * 4 + 100,
      y: point.y * 4 + 50,
    });
    viewportToFramedGraphPoint = (point) => ({
      x: (point.x - 100) / 40,
      y: (point.y - 50) / 40,
    });

    const renderer = new SigmaRenderer();
    renderer.mount({ container: requireContainer() });

    expect(renderer.centerOnCoordinates(25, -5)).toBe(true);
    expect(lastCamera?.state).toMatchObject({
      x: 2.5,
      y: -0.5,
      ratio: 1,
    });

    renderer.unmount();
  });

  it("clears focused node selection when the canvas background is clicked", () => {
    document.body.innerHTML = `<div id="${CONTAINER_ID}" style="width:300px;height:200px"></div>`;

    const renderer = new SigmaRenderer();
    const nodeClickHandler = vi.fn();
    renderer.mount({ container: requireContainer() });
    renderer.setNodeClickHandler(nodeClickHandler);
    renderer.render({
      nodes: [
        { id: "target", x: 0, y: 0, size: 6 },
        { id: "nearby", x: 2, y: 1, size: 6 },
      ],
      edges: [],
      viewMeta: { layout: "force", lodLevel: 0 },
    });

    renderer.focusNode("target");
    expect(lastSigmaOptions?.nodeReducer).toEqual(expect.any(Function));

    lastStageClickHandler?.();

    expect(lastSigmaOptions?.nodeReducer).toBeNull();
    expect(nodeClickHandler).toHaveBeenCalledWith({ nodeId: null });

    renderer.unmount();
  });

  it("uses darker Full MST grayscale links for lower distances", () => {
    document.body.innerHTML = `<div id="${CONTAINER_ID}" style="width:300px;height:200px"></div>`;

    const renderer = new SigmaRenderer();
    renderer.mount({ container: requireContainer() });
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
    expect(lastGraph?.getEdgeAttribute("far", "color")).toBe("#969696");

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
      sigmaCameraToViewportState({ minX: -120, maxX: 280, minY: 0, maxY: 300 }, { x: 0.25, y: 0.5, ratio: 0.5 }),
    ).toEqual({
      x: -20,
      y: 150,
      width: 200,
      height: 150,
    });
  });

  it("derives semantic view state from normalized sigma camera state", () => {
    expect(
      sigmaCameraToSemanticViewState({ minX: -120, maxX: 280, minY: 0, maxY: 300 }, { x: -10, y: 2, ratio: 0.25 }),
    ).toEqual({
      camera: {
        x: 0,
        y: 1,
        ratio: 0.25,
      },
      viewport: {
        x: -120,
        y: 300,
        width: 100,
        height: 75,
      },
      lodZoom: 3,
      edgeDistanceLabelsVisible: true,
    });
  });

  it("emits camera viewports in global graph bounds when a slice provides them", () => {
    document.body.innerHTML = `<div id="${CONTAINER_ID}" style="width:300px;height:200px"></div>`;

    const renderer = new SigmaRenderer();
    const handler = vi.fn();
    renderer.mount({ container: requireContainer() });
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

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {
      return undefined;
    });
    const renderer = new SigmaRenderer();
    renderer.mount({ container: requireContainer() });
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
    expect(warnSpy).toHaveBeenCalledWith(
      "Failed to build Sigma piechart program; falling back to default nodes.",
      expect.objectContaining({
        sliceCount: 1,
        sliceKeys: ["pie__country__value__canada"],
        error: expect.any(Error),
      }),
    );

    shouldThrowOnPieProgram = false;
    expect(() =>
      renderer.render({
        nodes: [{ id: "a", x: 0, y: 0 }],
        edges: [],
        viewMeta: { layout: "force", lodLevel: 0 },
      }),
    ).not.toThrow();

    renderer.unmount();
    warnSpy.mockRestore();
  });

  it("does not reconstruct Sigma when applying a plain server graph snapshot", () => {
    document.body.innerHTML = `<div id="${CONTAINER_ID}" style="width:300px;height:200px"></div>`;
    const plainGraph = {
      nodes: [{ id: "leaf", x: 0, y: 0, size: 5, color: "#93c5fd", attributes: { color: "#93c5fd", size: 5 } }],
      edges: [],
      viewMeta: { layout: "server" as const, lodLevel: 0 },
    };

    const renderer = new SigmaRenderer();
    renderer.mount({ container: requireContainer() });
    // One construction from mount(); reset so we count only snapshot-driven rebuilds.
    sigmaConstructions = 0;

    renderer.applyGraphSnapshot(plainGraph);
    renderer.applyGraphSnapshot(plainGraph);

    expect(sigmaConstructions).toBe(0);

    renderer.unmount();
  });

  it("rebuilds pie programs when category colors change", () => {
    document.body.innerHTML = `<div id="${CONTAINER_ID}" style="width:300px;height:200px"></div>`;

    const renderer = new SigmaRenderer();
    renderer.mount({ container: requireContainer() });
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
    renderer.mount({ container: requireContainer() });
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

    const latestPieProgram = pieProgramInputs.at(-1);
    expect(latestPieProgram?.slices).toHaveLength(MAX_PIE_SLICE_KEYS);
    expect(latestPieProgram?.slices.map((slice) => slice.value.attribute)).toContain(PIE_OTHER_SLICE_KEY);
    expect(lastGraph?.getNodeAttribute("node_0", PIE_OTHER_SLICE_KEY)).toBe(1);
    expect(lastGraph?.getNodeAttribute("node_0", "type")).toBe("piechart");

    renderer.unmount();
  });

  it("keeps node piecharts visible for 24-category PHYLOViZ fields", () => {
    document.body.innerHTML = `<div id="${CONTAINER_ID}" style="width:300px;height:200px"></div>`;

    const categories = Array.from({ length: 24 }, (_, index) => `emm_${index}`);
    const renderer = new SigmaRenderer();
    renderer.mount({ container: requireContainer() });
    renderer.render({
      nodes: categories.map((category, index) => ({
        id: `node_${index}`,
        x: index,
        y: index,
        attributes: {
          [`${PIE_ATTRIBUTE_PREFIX}emm_type__value__${category}`]: index + 1,
        },
      })),
      edges: [],
      viewMeta: { layout: "force", lodLevel: 0 },
    });

    const latestPieProgram = pieProgramInputs.at(-1);
    expect(latestPieProgram?.slices).toHaveLength(MAX_PIE_SLICE_KEYS);
    expect(latestPieProgram?.slices.map((slice) => slice.value.attribute)).toContain(PIE_OTHER_SLICE_KEY);
    expect(lastGraph?.getNodeAttribute("node_0", "type")).toBe("piechart");
    expect(lastGraph?.getNodeAttribute("node_0", PIE_OTHER_SLICE_KEY)).toBe(1);

    renderer.unmount();
  });

  it("toggles and restores node selection styling in-place in viewport sync mode", () => {
    document.body.innerHTML = `<div id="${CONTAINER_ID}" style="width:300px;height:200px"></div>`;

    const renderer = new SigmaRenderer();
    renderer.mount({ container: requireContainer() });
    renderer.applyGraphSnapshot({
      nodes: [
        { id: "node_1", x: 10, y: 20, size: 5, color: "#93c5fd", attributes: { color: "#93c5fd", size: 5 } },
        { id: "node_2", x: 30, y: 40, size: 5, color: "#93c5fd", attributes: { color: "#93c5fd", size: 5 } },
      ],
      edges: [],
      viewMeta: { layout: "server", lodLevel: 0 },
    });

    const graph = (renderer as unknown as { graph: Graph }).graph;

    // Nodes keep their base graphology attributes; selection is a render reducer.
    expect(graph.getNodeAttribute("node_1", "unselectedStyle")).toBeUndefined();
    expect(graph.getNodeAttribute("node_1", "type")).toBeUndefined();
    expect(graph.getNodeAttribute("node_1", "color")).toBe("#93c5fd");

    renderer.focusNode("node_1");
    const selectedNodeReducer = lastSigmaOptions?.nodeReducer as
      ((id: string, data: Record<string, unknown>) => Record<string, unknown>) | undefined;
    expect(selectedNodeReducer?.("node_1", graph.getNodeAttributes("node_1"))).toMatchObject({
      type: "border",
      color: PHYLOVIZ_NODE_SELECTED_COLOR,
      borderColor: "#ffffff",
      forceLabel: true,
    });
    expect(graph.getNodeAttribute("node_1", "type")).toBeUndefined();
    expect(graph.getNodeAttribute("node_1", "color")).toBe("#93c5fd");

    renderer.focusNode("node_2");
    const nextNodeReducer = lastSigmaOptions?.nodeReducer as
      ((id: string, data: Record<string, unknown>) => Record<string, unknown>) | undefined;
    expect(nextNodeReducer?.("node_2", graph.getNodeAttributes("node_2"))).toMatchObject({
      type: "border",
      color: PHYLOVIZ_NODE_SELECTED_COLOR,
    });
    expect(graph.getNodeAttribute("node_1", "type")).toBeUndefined();
    expect(graph.getNodeAttribute("node_2", "type")).toBeUndefined();

    renderer.focusNode(null);
    expect(lastSigmaOptions?.nodeReducer).toBeNull();
    expect(graph.getNodeAttribute("node_2", "type")).toBeUndefined();

    renderer.unmount();
  });
});

describe("applyPieChartNodeTypes", () => {
  it("fills slice keys and flips nodes with pie data to the piechart type", () => {
    const graph = new Graph();
    graph.addNode("cluster", {
      type: "triangle",
      [`${PIE_ATTRIBUTE_PREFIX}region__value__eu`]: 3,
    });
    graph.addNode("leaf", {});
    const sliceKeys = [`${PIE_ATTRIBUTE_PREFIX}region__value__eu`, `${PIE_ATTRIBUTE_PREFIX}region__value__us`];

    applyPieChartNodeTypes(graph, sliceKeys);

    // Cluster has positive pie data: type flips (overriding triangle) and the
    // absent slice key is filled with 0 so the program can read it.
    expect(graph.getNodeAttribute("cluster", "type")).toBe(SIGMA_NODE_TYPE_PIECHART);
    expect(graph.getNodeAttribute("cluster", `${PIE_ATTRIBUTE_PREFIX}region__value__us`)).toBe(0);
    // Leaf has no positive pie data: type is left untouched.
    expect(graph.getNodeAttribute("leaf", "type")).toBeUndefined();
  });

  it("aggregates non-displayed pie keys into the Others slice", () => {
    const graph = new Graph();
    graph.addNode("n", {
      [`${PIE_ATTRIBUTE_PREFIX}region__value__eu`]: 2,
      [`${PIE_ATTRIBUTE_PREFIX}region__value__hidden`]: 5,
    });
    const sliceKeys = [`${PIE_ATTRIBUTE_PREFIX}region__value__eu`, PIE_OTHER_SLICE_KEY];

    applyPieChartNodeTypes(graph, sliceKeys);

    expect(graph.getNodeAttribute("n", PIE_OTHER_SLICE_KEY)).toBe(5);
    expect(graph.getNodeAttribute("n", "type")).toBe(SIGMA_NODE_TYPE_PIECHART);
  });

  it("leaves node types untouched when there are no slice keys", () => {
    const graph = new Graph();
    graph.addNode("n", {
      type: "triangle",
      [`${PIE_ATTRIBUTE_PREFIX}region__value__eu`]: 3,
    });

    applyPieChartNodeTypes(graph, []);

    expect(graph.getNodeAttribute("n", "type")).toBe("triangle");
  });
});
