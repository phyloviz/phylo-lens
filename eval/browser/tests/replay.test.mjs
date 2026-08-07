import assert from "node:assert/strict";
import test from "node:test";
import { createFixture } from "../src/fixtures.mjs";
import { startReplayServer } from "../src/replay.mjs";

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
