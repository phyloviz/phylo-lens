import { createHash } from "node:crypto";

export const FIXTURE_GENERATOR_VERSION = "rq2-fixture-v1";

export function createFixture({ id, nodeCount, triangleCount, seed, labelsEnabled }) {
  if (typeof id !== "string" || !id || !Number.isInteger(seed) || !Number.isInteger(nodeCount) || nodeCount < 1 || !Number.isInteger(triangleCount) || triangleCount < 0 || triangleCount > nodeCount || typeof labelsEnabled !== "boolean") {
    throw new Error("Fixture id, seed, counts, and labelsEnabled must be valid.");
  }
  const random = mulberry32(seed);
  const nodes = Array.from({ length: nodeCount }, (_, index) => {
    const angle = (index / nodeCount) * Math.PI * 2;
    const radius = 200 + random() * 40;
    const triangle = index < triangleCount;
    return {
      id: `node-${index}`, cluster_id: triangle ? `cluster-${index}` : "detail",
      x: Math.cos(angle) * radius, y: Math.sin(angle) * radius,
      layout_status: "ready", member_count: triangle ? 4 : 1,
      is_representative: triangle,
      metadata: triangle ? { is_cluster_proxy: true } : (labelsEnabled ? { label: `Node ${index}` } : {}),
    };
  });
  const edges = Array.from({ length: Math.max(0, nodeCount - 1) }, (_, index) => ({
    id: `edge-${index}`, source: `node-${index}`, target: `node-${index + 1}`, distance: 1,
  }));
  const fixture = {
    id, generator_version: FIXTURE_GENERATOR_VERSION, random_seed: seed,
    node_count: nodeCount, edge_count: edges.length, triangle_count: triangleCount,
    total_primitive_count: nodeCount + edges.length + triangleCount,
    bounds: { min_x: -250, max_x: 250, min_y: -250, max_y: 250 },
    labels_enabled: labelsEnabled, metadata_configuration: labelsEnabled ? "synthetic-labels" : "none",
    api_schema_version: "1", nodes, edges,
  };
  validateFixture(fixture);
  return { ...fixture, checksum_sha256: checksum(fixture) };
}

export function checksum(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function mulberry32(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

function validateFixture(fixture) {
  const ids = new Set(fixture.nodes.map((node) => node.id));
  if (ids.size !== fixture.node_count || fixture.edges.some((edge) => !ids.has(edge.source) || !ids.has(edge.target))) {
    throw new Error("Fixture contains inconsistent edge endpoints.");
  }
  if (fixture.nodes.filter((node) => node.metadata.is_cluster_proxy === true).length !== fixture.triangle_count) {
    throw new Error("Fixture triangle count is not represented by aggregate proxies.");
  }
  if (fixture.nodes.some((node) => !Number.isFinite(node.x) || !Number.isFinite(node.y))) {
    throw new Error("Fixture contains non-finite coordinates.");
  }
  const { min_x, max_x, min_y, max_y } = fixture.bounds;
  if (![min_x, max_x, min_y, max_y].every(Number.isFinite) || min_x >= max_x || min_y >= max_y) {
    throw new Error("Fixture bounds must be finite and non-degenerate.");
  }
  if (fixture.nodes.some((node) => node.x < min_x || node.x > max_x || node.y < min_y || node.y > max_y)) {
    throw new Error("Fixture coordinates must be inside declared bounds.");
  }
  if (fixture.nodes.some((node) => !Number.isInteger(node.member_count) || node.member_count < 1)) {
    throw new Error("Fixture aggregate represented counts must be positive integers.");
  }
}
