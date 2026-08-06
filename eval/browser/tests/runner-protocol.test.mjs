import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { observationValidity } from "../src/validity.mjs";

const runnerPath = fileURLToPath(new URL("../src/runner.mjs", import.meta.url));

test("runner keeps stdout to one JSON failure record", async () => {
  const child = spawn(process.execPath, [runnerPath], { stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const exitCode = await new Promise((resolve) => child.on("close", resolve));
  assert.equal(exitCode, 0);
  const lines = stdout.trim().split("\n");
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).status, "failure");
  assert.match(stderr, /cleanup_complete/);
});

test("one deliberate viewport request after initial render invalidates the repetition", () => {
  assert.deepEqual(observationValidity({ unexpectedNetworkCount: 0, unexpectedViewportRequests: 1, frameSampleCount: 10, minimumFrameSampleCount: 4, replayContractFailure: false }), {
    status: "invalid", failure_kind: "unexpected_viewport_request",
  });
});
