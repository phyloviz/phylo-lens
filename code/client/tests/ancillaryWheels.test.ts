import { describe, expect, it } from "vitest";
import ancillaryWheels from "../src/app/shell/ancillary/ancillaryWheels";
import type { PositionedGraph } from "../src/contracts/positioned";

function fixture() {
  let graph: PositionedGraph = {
    nodes: [
      {
        id: "profile",
        x: 0,
        y: 0,
        attributes: {
          member_count: 1,
          metadata: {
            profile_count: 2,
            country: "Portugal;Spain",
            __category_count__country__value__Portugal: 1,
            __category_count__country__value__Spain: 1,
          },
          isolates: [
            { id: "Original A", metadata: { country: "Portugal" } },
            { id: "<b>Original B</b>", metadata: { country: "Spain" } },
          ],
        },
      },
    ],
    edges: [],
    viewMeta: { layout: "server", lodLevel: 0 },
  };
  let fields: string[] = [];
  const overview = document.createElement("div");
  const selected = document.createElement("div");
  const wheels = ancillaryWheels({
    overviewContainer: overview,
    selectedNodeContainer: selected,
    getGraph: () => graph,
    getSelectedFields: () => fields,
    getVisualMapping: () => ({}),
    getCategoryColorOverrides: () => ({}),
    selectPieFieldMessage: "Choose a field",
    selectedNodeEmptyMessage: "Choose a node",
  });
  return {
    wheels,
    overview,
    selected,
    setFields: (next: string[]) => {
      fields = next;
    },
    setGraph: (next: PositionedGraph) => {
      graph = next;
    },
  };
}

describe("ancillary node inspection", () => {
  it("shows original IDs and counts without metadata coloring, treating IDs as text", () => {
    const { wheels, selected } = fixture();
    wheels.renderSelectedNode("profile");
    expect(selected.textContent).toContain("Profile: profile");
    expect(selected.textContent).toContain("2 isolates");
    expect([...selected.querySelectorAll("li")].map((item) => item.textContent)).toEqual([
      "Original A",
      "<b>Original B</b>",
    ]);
    expect(selected.querySelector("b")).toBeNull();
    expect(selected.textContent).toContain("Ancillary coloring: none");
  });

  it("keeps the selected profile and displays the active field and per-isolate distribution", () => {
    const { wheels, selected, overview, setFields } = fixture();
    wheels.renderSelectedNode("profile");
    const details = selected.querySelector("details");
    if (details) details.open = true;
    setFields(["country"]);
    wheels.refreshSelectedNode();
    wheels.renderOverview();
    expect(selected.textContent).toContain("Profile: profile");
    expect(selected.textContent).toContain("Color field: country");
    expect(selected.querySelector("details")?.open).toBe(true);
    expect(selected.querySelectorAll(".wheel-meta li")).toHaveLength(2);
    expect(selected.textContent?.match(/50.0%/g)).toHaveLength(2);
    expect(overview.textContent).toContain("Current view · Color field: country");
    setFields([]);
    wheels.refreshSelectedNode();
    expect(selected.querySelector(".wheel-chart")).toBeNull();
    expect(selected.textContent).toContain("2 isolates");
    wheels.resetSelectedNode();
    wheels.refreshSelectedNode();
    expect(selected.textContent).toBe("Choose a node");
  });

  it("does not leave stale details when the selected node leaves the viewport", () => {
    const { wheels, selected, setGraph } = fixture();
    wheels.renderSelectedNode("profile");
    setGraph({ nodes: [], edges: [], viewMeta: { layout: "server", lodLevel: 0 } });
    wheels.refreshSelectedNode();
    expect(selected.textContent).toContain("outside the current view");
    expect(selected.textContent).not.toContain("Original A");
  });

  it("distinguishes a LoD cluster from a biological profile", () => {
    const { wheels, selected, setGraph } = fixture();
    setGraph({
      nodes: [
        { id: "cluster", x: 0, y: 0, attributes: { member_count: 3, metadata: { profile_count: 7 }, isolates: [] } },
      ],
      edges: [],
      viewMeta: { layout: "server", lodLevel: 1 },
    });
    wheels.renderSelectedNode("cluster");
    expect(selected.textContent).toContain("Cluster: cluster");
    expect(selected.textContent).toContain("3 profiles · 7 isolates");
    expect(selected.querySelector("details")).toBeNull();
  });
});
