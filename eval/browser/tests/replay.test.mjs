import assert from "node:assert/strict";
import test from "node:test";
import { createFixture } from "../src/fixtures.mjs";
import { startFinalReplayServer, startReplayServer } from "../src/replay.mjs";

test("replay rejects unknown routes and records the response", async () => {
  const replay = await startReplayServer(
    createFixture({
      id: "test",
      nodeCount: 2,
      triangleCount: 0,
      seed: 3,
      labelsEnabled: false,
    }),
  );
  try {
    const response = await fetch(`${replay.apiUrl}/not-a-route`);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), {
      detail: "Unsupported replay endpoint.",
    });
    assert.equal(replay.accessLog.at(-1).status, 404);
    assert.ok(replay.accessLog.at(-1).response_bytes > 0);
  } finally {
    await replay.close();
  }
});

test("final replay fixes the global prepared count while preserving fixture cardinality", async () => {
  const fixture = createFixture({
    id: "final",
    nodeCount: 3,
    triangleCount: 1,
    seed: 5,
    labelsEnabled: false,
  });
  const replay = await startFinalReplayServer({
    fixture,
    globalPreparedNodeCount: 100000,
    maxNodes: 100000,
  });
  try {
    const response = await fetch(`${replay.apiUrl}/api/graph/viewport`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dataset_id: "final", max_nodes: 100000, zoom: 1 }),
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.total_node_count, 100000);
    assert.equal(body.nodes.length, 3);
    assert.equal(body.edges.length, 2);
    assert.equal(body.truncated, false);
    assert.equal(
      replay.accessLog.at(-1).response_sha256,
      replay.responseSha256,
    );
  } finally {
    await replay.close();
  }
});

test("replay rejects malformed prepare requests", async () => {
  const replay = await startReplayServer(
    createFixture({
      id: "test",
      nodeCount: 2,
      triangleCount: 0,
      seed: 3,
      labelsEnabled: false,
    }),
  );
  try {
    const response = await fetch(`${replay.apiUrl}/api/graph/prepare`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ format: "not-newick" }),
    });
    assert.equal(response.status, 422);
  } finally {
    await replay.close();
  }
});
