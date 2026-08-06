import test from "node:test";
import assert from "node:assert/strict";
import { createFixture } from "../src/fixtures.mjs";

test("deterministic fixture has exact primitive composition", () => {
  const first = createFixture({ id: "pilot", nodeCount: 12, triangleCount: 3, seed: 7, labelsEnabled: false });
  const second = createFixture({ id: "pilot", nodeCount: 12, triangleCount: 3, seed: 7, labelsEnabled: false });
  assert.equal(first.checksum_sha256, second.checksum_sha256);
  assert.equal(first.node_count, 12); assert.equal(first.edge_count, 11); assert.equal(first.triangle_count, 3); assert.equal(first.total_primitive_count, 26);
  assert.ok(first.bounds.min_x < first.bounds.max_x);
  assert.ok(first.bounds.min_y < first.bounds.max_y);
});
