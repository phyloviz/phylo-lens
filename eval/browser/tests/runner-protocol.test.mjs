import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { observationValidity } from "../src/validity.mjs";

const runnerPath = fileURLToPath(new URL("../src/runner.mjs", import.meta.url));

test("runner keeps stdout to one JSON failure record", async () => {
  const child = spawn(process.execPath, [runnerPath], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const exitCode = await new Promise((resolve) => child.on("close", resolve));
  assert.equal(exitCode, 0);
  const lines = stdout.trim().split("\n");
  assert.equal(lines.length, 1);
  assert.equal(JSON.parse(lines[0]).status, "failure");
  assert.match(stderr, /cleanup_complete/);
});

test("one deliberate viewport request after initial render invalidates the repetition", () => {
  assert.deepEqual(
    observationValidity({
      unexpectedNetworkCount: 0,
      unexpectedViewportRequests: 1,
      frameSampleCount: 10,
      minimumFrameSampleCount: 4,
      replayContractFailure: false,
    }),
    {
      status: "invalid",
      failure_kind: "unexpected_viewport_request",
    },
  );
});

test("fixed pilot replay accepts camera refreshes without hiding contract failures", () => {
  const input = {
    unexpectedNetworkCount: 0,
    unexpectedViewportRequests: 2,
    frameSampleCount: 10,
    minimumFrameSampleCount: 4,
    replayContractFailure: false,
    fixedReplayViewport: true,
  };
  assert.deepEqual(observationValidity(input), {
    status: "success",
    failure_kind: "none",
  });
  assert.deepEqual(
    observationValidity({ ...input, replayContractFailure: true }),
    {
      status: "failure",
      failure_kind: "replay_contract_failure",
    },
  );
  assert.deepEqual(
    observationValidity({ ...input, unexpectedNetworkCount: 1 }),
    {
      status: "invalid",
      failure_kind: "unexpected_network_request",
    },
  );
  assert.deepEqual(observationValidity({ ...input, frameSampleCount: 0 }), {
    status: "invalid",
    failure_kind: "insufficient_frame_samples",
  });
});
