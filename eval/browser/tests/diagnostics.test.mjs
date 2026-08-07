import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  atomicWriteJson,
  classifyFailure,
  closeAll,
  withTimeout,
} from "../src/diagnostics.mjs";

test("render-stage timeout has the stable render timeout classification", async () => {
  await assert.rejects(
    () => withTimeout("bootstrap", 5, () => new Promise(() => {})),
    { code: "STAGE_TIMEOUT" },
  );
  const error = Object.assign(new Error("timeout:bootstrap"), {
    code: "STAGE_TIMEOUT",
  });
  assert.equal(
    classifyFailure(error, "view_load_and_raf_start"),
    "render_timeout",
  );
});

test("cleanup continues after an injected close failure", async () => {
  const closed = [];
  const failures = [];
  await closeAll(
    [
      [
        "first",
        {
          close: async () => {
            closed.push("first");
            throw new Error("injected");
          },
        },
      ],
      [
        "second",
        {
          close: async () => {
            closed.push("second");
          },
        },
      ],
    ],
    (name, error) => failures.push([name, String(error)]),
  );
  assert.deepEqual(closed, ["first", "second"]);
  assert.deepEqual(failures, [["first", "Error: injected"]]);
});

test("runtime state is atomically published as JSON", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rq2-runtime-state-"));
  const path = join(directory, "runtime-state.json");
  await atomicWriteJson(path, { browser_pid: 123, phase: "launched" });
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), {
    browser_pid: 123,
    phase: "launched",
  });
  assert.equal(
    (await readdir(directory)).some((name) => name.endsWith(".tmp")),
    false,
  );
});
