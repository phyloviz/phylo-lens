import {
  toClusterId,
  toDatasetId,
  toLayoutVersion,
  toNodeId,
  type AncillaryData,
  type GraphClient,
  type GraphViewportNode,
  type GraphViewportEdge,
} from "@phyloviz/phylo-lens";

// This adapter serves one declared fixture, not a general Newick parser.
export const EXAMPLE_NEWICK = "((PT-01:1,PT-02:1)Lineage:1,ES-01:2)Root;";
const datasetId = toDatasetId("precomputed-example");
const layoutVersion = toLayoutVersion("precomputed-v1");
const schema = [{ key: "country", type: "string" as const }];
const nodes: GraphViewportNode[] = [
  ["Root", 0, 0, null, 0, 0, 5, ""],
  ["Lineage", 2, 1, "Root", 1, 1, 4, ""],
  ["PT-01", 4, 2, "Lineage", 2, 2, 3, "Portugal"],
  ["PT-02", 4, 0, "Lineage", 2, 3, 4, "Portugal"],
  ["ES-01", 1, -2, "Root", 1, 4, 5, "Spain"],
].map(([id, x, y, parent, depth, start, end, country]) => {
  const ancillaryData: AncillaryData = country
    ? { country: String(country) }
    : {};
  return {
    id: toNodeId(String(id)),
    clusterId: toClusterId(String(id)),
    x: Number(x),
    y: Number(y),
    memberCount: 1,
    isRepresentative: false,
    layoutStatus: "ready",
    treeIndex: {
      componentId: "Root",
      parentId: parent === null ? null : String(parent),
      depth: Number(depth),
      start: Number(start),
      end: Number(end),
    },
    annotations: {
      ancillaryData,
      ancillarySummary: { values: {}, categoryCounts: {} },
      profileSummary: {},
    },
  };
});
const edges: GraphViewportEdge[] = [
  ["Root", "Lineage", 1],
  ["Root", "ES-01", 2],
  ["Lineage", "PT-01", 1],
  ["Lineage", "PT-02", 1],
].map(([source, target, distance], index) => ({
  id: `edge-${index}`,
  source: toNodeId(String(source)),
  target: toNodeId(String(target)),
  distance: Number(distance),
}));

/** Only prepareGraph and readViewport are required to render an existing layout. */
export function createPrecomputedClient(): GraphClient {
  return {
    async prepareGraph(request) {
      if (
        request.format !== "newick" ||
        request.content.trim() !== EXAMPLE_NEWICK ||
        request.distanceCutoff !== undefined ||
        request.typingOptions !== undefined ||
        request.ancillaryData ||
        Object.keys(request.ancillaryByNodeId ?? {}).length ||
        request.ancillarySchema?.length
      ) {
        throw new Error(
          "This precomputed adapter accepts only its declared example tree and annotations.",
        );
      }
      return {
        datasetId,
        layoutVersion,
        nodeCount: nodes.length,
        edgeCount: edges.length,
        clusterCount: nodes.length,
        lodTierCount: 1,
        technicalRoots: ["Root"],
        layoutStatus: "ready",
        warnings: [],
      };
    },
    async readViewport(request, options) {
      if (options?.signal?.aborted)
        throw new DOMException("Aborted", "AbortError");
      if (
        request.datasetId !== datasetId ||
        (request.layoutVersion && request.layoutVersion !== layoutVersion)
      ) {
        throw new Error("Unknown precomputed dataset revision.");
      }
      if (request.componentId && request.componentId !== "Root")
        throw new Error("Unknown component.");
      const matching = nodes.filter(
        (node) =>
          (request.xmin === undefined || node.x >= request.xmin) &&
          (request.xmax === undefined || node.x <= request.xmax) &&
          (request.ymin === undefined || node.y >= request.ymin) &&
          (request.ymax === undefined || node.y <= request.ymax),
      );
      const visible = matching.slice(0, request.maxNodes ?? matching.length);
      const ids = new Set(visible.map((node) => node.id));
      return {
        datasetId,
        layoutVersion,
        nodes: visible,
        edges: edges.filter(
          (edge) => ids.has(edge.source) && ids.has(edge.target),
        ),
        totalNodeCount: matching.length,
        truncated: visible.length < matching.length,
        zoom: request.zoom ?? 1,
        lodLevel: 0,
        layoutStatus: "ready",
        globalBounds: { minX: 0, maxX: 4, minY: -2, maxY: 2 },
        ancillarySchema: schema,
      };
    },
    async searchGraph(request) {
      if (
        request.datasetId !== datasetId ||
        request.layoutVersion !== layoutVersion
      )
        throw new Error("Unknown dataset revision.");
      const query = request.query.toLowerCase();
      const matches = nodes
        .filter((node) => node.id.toLowerCase().includes(query))
        .map((node) => ({
          nodeId: node.id,
          clusterId: node.clusterId,
          x: node.x,
          y: node.y,
          score: node.id.toLowerCase() === query ? 100 : 60,
          matchedText: node.id,
        }));
      return {
        datasetId,
        query: request.query,
        matches: matches.slice(0, request.limit ?? 25),
        totalCount: matches.length,
      };
    },
  };
}
