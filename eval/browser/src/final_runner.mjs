/* Final RQ2 bounded browser child. stdout is exactly one terminal JSON record. */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { chromium } from "@playwright/test";
import { createFixture } from "./fixtures.mjs";
import { startFinalReplayServer } from "./replay.mjs";
import { closeAll, withTimeout } from "./diagnostics.mjs";

const [controlPath, resultPath] = process.argv.slice(2);
const { version: playwrightVersion } = createRequire(import.meta.url)(
  "@playwright/test/package.json",
);
let control;
let replay;
let web;
let browserServer;
let browser;
let context;
let page;
let cdp;
const logs = {
  requests: [],
  responses: [],
  failures: [],
  pageErrors: [],
  console: [],
};

function stage(name) {
  process.stderr.write(`${new Date().toISOString()} ${name}\n`);
}

function emit(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

async function writeJson(path, payload) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(payload, null, 2));
}

async function runtimeState(payload) {
  await writeJson(control.runtime_state_path, payload);
}

async function bounded(name, task) {
  stage(`${name}_start`);
  return withTimeout(name, 12_000, task);
}

function available(bytes) {
  return { state: "available", bytes, reason: null };
}

function unavailable(reason) {
  return { state: "unavailable", bytes: null, reason };
}

async function heapSnapshot() {
  try {
    const usage = await cdp.send("Runtime.getHeapUsage");
    return {
      js_heap_used_bytes: Number.isFinite(usage.usedSize)
        ? available(usage.usedSize)
        : unavailable("CDP omitted usedSize"),
      js_heap_total_bytes: Number.isFinite(usage.totalSize)
        ? available(usage.totalSize)
        : unavailable("CDP omitted totalSize"),
      embedder_heap_used_bytes: Number.isFinite(usage.embedderHeapUsedSize)
        ? available(usage.embedderHeapUsedSize)
        : unavailable("CDP did not expose embedder heap"),
      backing_storage_bytes: Number.isFinite(usage.backingStorageSize)
        ? available(usage.backingStorageSize)
        : unavailable("CDP did not expose backing storage"),
    };
  } catch (error) {
    const reason = `Runtime.getHeapUsage unavailable: ${String(error)}`;
    return {
      js_heap_used_bytes: unavailable(reason),
      js_heap_total_bytes: unavailable(reason),
      embedder_heap_used_bytes: unavailable(reason),
      backing_storage_bytes: unavailable(reason),
    };
  }
}

function heapDelta(before, after) {
  return Object.fromEntries(
    Object.keys(before).map((key) => {
      const left = before[key];
      const right = after[key];
      return [
        key,
        left.state === "available" && right.state === "available"
          ? available(right.bytes - left.bytes)
          : unavailable("Metric unavailable at one or both snapshots"),
      ];
    }),
  );
}

async function runFrameStress(input) {
  const box = await page.locator("#graph-root canvas").first().boundingBox();
  if (!box) throw new Error("snapshot_fixture_mismatch: canvas missing");
  const x = Math.round(box.x + box.width / 2);
  const y = Math.round(box.y + box.height / 2);
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let step = 1; step <= input.drag_steps; step += 1) {
    await page.mouse.move(
      x + (input.drag_dx * step) / input.drag_steps,
      y + (input.drag_dy * step) / input.drag_steps,
    );
    if (input.step_delay_ms) await page.waitForTimeout(input.step_delay_ms);
  }
  await page.mouse.up();
  await page.mouse.wheel(0, input.zoom_in_delta_y);
  if (input.wheel_delay_ms) await page.waitForTimeout(input.wheel_delay_ms);
  await page.mouse.wheel(0, input.zoom_out_delta_y);
  if (input.wheel_delay_ms) await page.waitForTimeout(input.wheel_delay_ms);
}

function graphRequests() {
  return replay.accessLog.filter((item) => item.path === "/api/graph/viewport");
}

function gpuClassification(raw) {
  const vendor = raw?.vendor ?? null;
  const renderer = raw?.renderer ?? null;
  const text = `${vendor ?? ""} ${renderer ?? ""}`;
  const software = /swiftshader|software|llvmpipe/i.test(text);
  const hardware = Boolean(raw?.available && vendor && renderer && !software);
  return {
    hardware_accelerated: hardware,
    webgl_vendor: vendor,
    webgl_renderer: renderer,
    backend: /metal/i.test(text)
      ? "Metal"
      : hardware
        ? "WebGL hardware backend"
        : null,
    evidence: hardware
      ? `WebGL vendor=${vendor}; renderer=${renderer}`
      : `GPU evidence unavailable or software: ${text || "none"}`,
  };
}

try {
  if (!controlPath || !resultPath)
    throw new Error(
      "harness_protocol_failure: control and result paths are required",
    );
  control = JSON.parse(await readFile(controlPath, "utf8"));
  const fixture = createFixture({
    id: control.fixture.id,
    nodeCount: control.fixture.node_count,
    triangleCount: control.fixture.triangle_count,
    seed: control.fixture.seed,
    labelsEnabled: control.fixture.labels_enabled,
  });
  if (
    fixture.total_primitive_count !== control.fixture.expected_primitive_count
  )
    throw new Error(
      "fixture_integrity_failure: generated primitive count differs from frozen fixture metadata",
    );
  replay = await bounded("replay", () =>
    startFinalReplayServer({
      fixture,
      globalPreparedNodeCount: control.global_prepared_node_count,
      maxNodes: control.max_nodes,
    }),
  );
  web = await bounded("web", () =>
    startPageServer(resolve(control.browser_dist_path)),
  );
  browserServer = await bounded("chromium_launch", () =>
    chromium.launchServer({
      headless: false,
      args: control.browser.launch_args,
    }),
  );
  browser = await bounded("playwright_connect", () =>
    chromium.connect(browserServer.wsEndpoint()),
  );
  const runtime = {
    browser_pid: browserServer.process()?.pid ?? null,
    browser_version: browser.version(),
    browser_executable_path: chromium.executablePath() || null,
    phase: "launched",
  };
  await runtimeState(runtime);
  context = await bounded("context", () =>
    browser.newContext({
      viewport: control.browser.viewport,
      deviceScaleFactor: control.browser.device_scale_factor,
      locale: control.browser.locale,
      timezoneId: control.browser.timezone,
    }),
  );
  const origins = new Set([
    new URL(web.url).origin,
    new URL(replay.apiUrl).origin,
  ]);
  await context.route("**/*", async (route) => {
    const url = route.request().url();
    if (origins.has(new URL(url).origin)) return route.continue();
    logs.failures.push({ type: "unexpected_network", url });
    return route.abort();
  });
  page = await bounded("page", () => context.newPage());
  page.setDefaultTimeout(12_000);
  page.on("request", (request) =>
    logs.requests.push({ url: request.url(), method: request.method() }),
  );
  page.on("response", (response) =>
    logs.responses.push({ url: response.url(), status: response.status() }),
  );
  page.on("requestfailed", (request) =>
    logs.failures.push({ type: "request_failed", url: request.url() }),
  );
  page.on("pageerror", (error) => logs.pageErrors.push(String(error)));
  page.on("console", (message) =>
    logs.console.push({ type: message.type(), text: message.text() }),
  );
  await bounded("navigation", () =>
    page.goto(web.url, { waitUntil: "domcontentloaded" }),
  );
  await bounded("bootstrap", () =>
    page.waitForFunction(
      () => document.documentElement.dataset.rq2Bootstrap === "ready",
    ),
  );
  cdp = await bounded("cdp", () => context.newCDPSession(page));
  const gpu = gpuClassification(
    await bounded("gpu_evidence", () =>
      page.evaluate(() => window.phyloLensEvaluation?.rq2Final?.gpuEvidence()),
    ),
  );
  if (!gpu.hardware_accelerated)
    throw new Error(
      "gpu_preflight_failure: hardware accelerated WebGL evidence is required",
    );
  await bounded("create_view", () =>
    page.evaluate(
      (apiUrl) => window.phyloLensEvaluation?.rq2Final?.createView(apiUrl),
      replay.apiUrl,
    ),
  );
  const heapBaseline = await bounded("heap_baseline", heapSnapshot);
  runtime.phase = "baseline";
  await runtimeState(runtime);
  const first = await bounded("view_load", () =>
    page.evaluate(
      ({ maxNodes }) =>
        window.phyloLensEvaluation?.rq2Final?.load(
          "(A:1,B:1)root;",
          "rq2-final-replay",
          maxNodes,
        ),
      { maxNodes: control.max_nodes },
    ),
  );
  runtime.phase = "post_t2";
  await runtimeState(runtime);
  await bounded("quiescence", () => page.waitForTimeout(control.quiescence_ms));
  const heapPost = await bounded("heap_post_t2", heapSnapshot);
  const beforeStress = graphRequests().length;
  await bounded("frame_start", () =>
    page.evaluate(() =>
      window.phyloLensEvaluation?.rq2Final?.startFrameSampling(),
    ),
  );
  await bounded("frame_stress", () => runFrameStress(control.frame_stress));
  const frameIntervalsMs = await bounded("frame_finish", () =>
    page.evaluate(() =>
      window.phyloLensEvaluation?.rq2Final?.finishFrameSampling(),
    ),
  );
  const afterStress = graphRequests().length;
  const requests = graphRequests();
  const snapshot = first?.snapshot ?? null;
  const snapshotCongruent = Boolean(
    snapshot &&
    snapshot.reason === "initial_load" &&
    snapshot.visibleNodeCount === fixture.node_count &&
    snapshot.visibleEdgeCount === fixture.edge_count &&
    snapshot.visiblePrimitiveCount ===
      fixture.node_count + fixture.edge_count &&
    snapshot.triangleCount === fixture.triangle_count,
  );
  const truncated = requests.some((item) => item.truncated !== false);
  const cardinalityValid = requests.every(
    (item) =>
      item.fixture_node_count === fixture.node_count &&
      item.fixture_edge_count === fixture.edge_count &&
      item.fixture_triangle_count === fixture.triangle_count &&
      item.response_sha256 === replay.responseSha256,
  );
  const postInitial = afterStress - beforeStress;
  const requestPatternValid =
    requests.length === 1 &&
    postInitial ===
      control.frame_stress.expected_post_initial_viewport_requests;
  await writeJson(control.frame_samples_path, {
    frame_intervals_ms: frameIntervalsMs,
  });
  await writeJson(control.replay_access_log_path, replay.accessLog);
  await bounded("screenshot", () =>
    page.screenshot({ path: resolve(control.screenshot_path) }),
  );
  await bounded("dispose", () =>
    page.evaluate(() => window.phyloLensEvaluation?.rq2Final?.dispose()),
  );
  const timing = {
    t0_ms: first?.t0 ?? null,
    t1_ms: first?.t1 ?? null,
    t2_ms: first?.t2 ?? null,
    client_first_visualization_ms: first ? first.t2 - first.t0 : null,
    load_resolve_ms: first ? first.t1 - first.t0 : null,
    post_load_frame_ms: first ? first.t2 - first.t1 : null,
  };
  let status = "success";
  let failureKind = "none";
  if (!requestPatternValid)
    [status, failureKind] = ["invalid", "request_pattern_failure"];
  else if (!snapshotCongruent || !cardinalityValid)
    [status, failureKind] = ["invalid", "snapshot_fixture_mismatch"];
  else if (truncated)
    [status, failureKind] = ["invalid", "unexpected_truncation"];
  const output = {
    status,
    failure_kind: failureKind,
    message: status === "success" ? null : failureKind,
    browser: {
      version: browser.version(),
      executable_path: chromium.executablePath() || null,
      playwright_version: playwrightVersion,
    },
    gpu,
    timing,
    heap: {
      baseline: heapBaseline,
      post_t2: heapPost,
      delta: heapDelta(heapBaseline, heapPost),
    },
    fixture: {
      id: fixture.id,
      sha256: fixture.checksum_sha256,
      response_sha256: replay.responseSha256,
      node_count: fixture.node_count,
      edge_count: fixture.edge_count,
      triangle_count: fixture.triangle_count,
      expected_primitive_count: fixture.total_primitive_count,
      mutated: false,
    },
    snapshot: {
      sequence: snapshot?.sequence ?? null,
      reason: snapshot?.reason ?? null,
      node_count: snapshot?.visibleNodeCount ?? null,
      edge_count: snapshot?.visibleEdgeCount ?? null,
      primitive_count: snapshot?.visiblePrimitiveCount ?? null,
      triangle_count: snapshot?.triangleCount ?? null,
      fixture_congruent: snapshotCongruent,
    },
    replay: {
      request_count: replay.accessLog.length,
      viewport_request_count: requests.length,
      post_initial_viewport_request_count: postInitial,
      request_pattern_valid: requestPatternValid,
      truncated,
      response_cardinality_valid: cardinalityValid,
      response_checksums: requests.map((item) => item.response_sha256),
    },
    frame_intervals_ms: frameIntervalsMs,
    diagnostics: logs,
  };
  await writeJson(resultPath, output);
  emit(output);
} catch (error) {
  const text = String(error);
  const failureKind =
    text.match(
      /(invalid_configuration|browser_launch_failure|gpu_preflight_failure|fixture_integrity_failure|request_pattern_failure|snapshot_fixture_mismatch|unexpected_truncation)/,
    )?.[1] ??
    (error?.code === "STAGE_TIMEOUT"
      ? "render_timeout"
      : "harness_protocol_failure");
  const output = {
    status: error?.code === "STAGE_TIMEOUT" ? "timeout" : "failure",
    failure_kind: failureKind,
    message: text,
    browser: {
      version: browser?.version?.() ?? null,
      executable_path: chromium.executablePath() || null,
      playwright_version: playwrightVersion,
    },
    gpu: {
      hardware_accelerated: false,
      webgl_vendor: null,
      webgl_renderer: null,
      backend: null,
      evidence: null,
    },
    timing: {},
    heap: {},
    fixture: {},
    snapshot: {},
    replay: {},
    frame_intervals_ms: [],
  };
  if (resultPath) await writeJson(resultPath, output);
  emit(output);
} finally {
  await closeAll([
    ["page", page],
    ["context", context],
    ["browser", browser],
    ["browserServer", browserServer],
    ["web", web],
    ["replay", replay],
  ]);
  stage("cleanup_complete");
}

async function startPageServer(root) {
  const server = createServer((request, response) => {
    const relative =
      request.url === "/"
        ? "index.html"
        : request.url.split("?")[0].replace(/^\//, "");
    const file = resolve(root, relative);
    if (!file.startsWith(root)) {
      response.writeHead(403);
      return response.end();
    }
    response.setHeader(
      "content-type",
      file.endsWith(".js")
        ? "text/javascript"
        : file.endsWith(".html")
          ? "text/html"
          : "application/octet-stream",
    );
    createReadStream(file)
      .on("error", () => {
        response.writeHead(404);
        response.end();
      })
      .pipe(response);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
