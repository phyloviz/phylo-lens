import { describe, expect, it } from "vitest";

import type { GraphViewportNode, GraphViewportResponse } from "../src/api/graphContracts";
import { graphSnapshotFromViewportResponse } from "../src/app/workbench/viewport/viewportSnapshot";

function viewportNode(id: string, overrides: Partial<GraphViewportNode> = {}): GraphViewportNode {
  return {
    id,
    cluster_id: id,
    x: 0,
    y: 0,
    layout_status: "ready",
    member_count: 1,
    is_representative: false,
    ...overrides,
  };
}

function viewportResponse(
  nodes: GraphViewportNode[],
  overrides: Partial<GraphViewportResponse> = {},
): GraphViewportResponse {
  return {
    dataset_id: "tree",
    layout_version: "layout-1",
    lod_level: 0,
    zoom: 1,
    layout_status: "ready",
    truncated: false,
    total_node_count: nodes.length,
    nodes,
    edges: [],
    metadata_schema: [],
    ...overrides,
  };
}

describe("viewportSnapshot", () => {
  it("uses compact node sizes for opened server slices", () => {
    const graph = graphSnapshotFromViewportResponse(
      viewportResponse([
        viewportNode("leaf"),
        viewportNode("cluster-huge", {
          member_count: 97_000,
          is_representative: true,
        }),
      ]),
    );

    expect(graph.nodes.find((node) => node.id === "leaf")?.size).toBe(3);
    expect(graph.nodes.find((node) => node.id === "cluster-huge")?.size).toBeLessThanOrEqual(6);
  });

  it("keeps labels available even for dense slices", () => {
    const small = graphSnapshotFromViewportResponse(viewportResponse([viewportNode("leaf")]));
    const dense = graphSnapshotFromViewportResponse(
      viewportResponse(Array.from({ length: 251 }, (_, index) => viewportNode(`leaf-${index}`))),
    );

    expect(small.nodes[0]?.attributes?.label).toBe("leaf");
    expect(dense.nodes[0]?.attributes?.label).toBe("leaf-0");
  });

  it("uses server-inferred metadata schema for viewport visual mapping", () => {
    const graph = graphSnapshotFromViewportResponse(
      viewportResponse(
        [
          viewportNode("leaf", {
            metadata: { country: "Portugal" },
          }),
        ],
        { metadata_schema: [{ key: "country", type: "string" }] },
      ),
      { visualMapping: {} },
    );

    expect(graph.nodes[0]?.color).not.toBe("#93c5fd");
  });

  it("applies display toggles to edge attributes in the first viewport snapshot", () => {
    const graph = graphSnapshotFromViewportResponse(
      viewportResponse([viewportNode("root"), viewportNode("leaf")], {
        edges: [{ id: "root-leaf", source: "root", target: "leaf", distance: 4 }],
      }),
      {
        displayOptions: {
          nodeLabels: false,
          edgeDistanceLabels: true,
          distanceWeightedEdges: true,
        },
      },
    );

    expect(graph.nodes[0]?.attributes?.label).toBe("");
    expect(graph.edges[0]?.attributes).toMatchObject({ label: "4", forceLabel: true });
    expect(graph.edges[0]?.attributes?.size).toBeGreaterThan(1);
  });

  it("honors linear and logarithmic size scales for numeric metadata strings", () => {
    const response = viewportResponse(
      [
        viewportNode("small", { metadata: { profile_count: "10" } }),
        viewportNode("middle", { metadata: { profile_count: "100" } }),
        viewportNode("large", { metadata: { profile_count: "1000" } }),
      ],
      { metadata_schema: [{ key: "profile_count", type: "number" }] },
    );

    const linear = graphSnapshotFromViewportResponse(response, {
      visualMapping: { size: { field: "profile_count", scale: "linear" } },
    });
    const logarithmic = graphSnapshotFromViewportResponse(response, {
      visualMapping: { size: { field: "profile_count", scale: "log" } },
    });

    expect(logarithmic.nodes[1]?.size ?? 0).toBeGreaterThan(linear.nodes[1]?.size ?? 0);
  });
});
