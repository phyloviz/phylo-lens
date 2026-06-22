import { isClusterProxyClick } from "../src/app/workbench/lod/clusterExpansion";

describe("clusterExpansion", () => {
  it("treats topology-preserving skeleton nodes as expandable clusters", () => {
    expect(
      isClusterProxyClick(
        {
          nodeId: "junction",
          attributes: {
            cluster_id: "threshold_cluster_2_1001",
            is_cluster_skeleton: true,
          },
        },
        {
          id: "junction",
          x: 0,
          y: 0,
          attributes: {
            cluster_id: "threshold_cluster_2_1001",
            is_cluster_skeleton: true,
          },
        },
      ),
    ).toBe(true);
  });
});
