/* Bounded RQ2 browser child. stdout is a single final JSON result; stderr is diagnostic only. */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { chromium } from "@playwright/test";
import { atomicWriteJson, closeAll, classifyFailure, withTimeout } from "./diagnostics.mjs";
import { createFixture } from "./fixtures.mjs";
import { startReplayServer } from "./replay.mjs";
import { observationValidity } from "./validity.mjs";

const [controlPath, resultPath] = process.argv.slice(2);
const started = performance.now();
const timeoutMs = 10_000;
let lastStage = "start";
let control;
let replay;
let web;
let browserServer;
let browser;
let context;
let page;
let cdp;
const logs = { console: [], page_errors: [], requests: [], responses: [], failures: [], unexpected_network: [], cleanup_failures: [] };

function stage(name, detail = "") {
  lastStage = name;
  process.stderr.write(`${new Date().toISOString()} ${name}${detail ? ` ${detail}` : ""}\n`);
}

function emit(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

async function bounded(name, operation) {
  stage(`${name}_start`);
  return withTimeout(name, timeoutMs, operation);
}

async function writeJson(path, payload) {
  if (!path) return;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(payload, null, 2));
}

async function writeRuntimeState(path, payload) {
  if (!path) return;
  await atomicWriteJson(path, payload);
}

async function setMeasurementPhase(runtimeState, phase) {
  runtimeState.phase = phase;
  runtimeState.phase_sequence = (runtimeState.phase_sequence ?? 0) + 1;
  runtimeState.phase_timestamp_utc = new Date().toISOString();
  await writeRuntimeState(control.runtime_state_path, runtimeState);
  if (!control.phase_ack_path || !["baseline", "post_render"].includes(phase)) return;
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    try {
      const acknowledgement = JSON.parse(await readFile(control.phase_ack_path, "utf8"));
      if (acknowledgement.phase === phase && acknowledgement.phase_sequence === runtimeState.phase_sequence) return;
    } catch { /* Python has not atomically published the acknowledgement yet. */ }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`process_monitor_failure: Python did not acknowledge ${phase} RSS sample`);
}

async function retainDiagnostics() {
  if (!resultPath) return {};
  await mkdir(dirname(resultPath), { recursive: true });
  const base = resolve(`${resultPath}.diagnostics`);
  const paths = { logs_path: `${base}.json` };
  await writeFile(paths.logs_path, JSON.stringify(logs, null, 2));
  if (page && !page.isClosed()) {
    paths.page_html_path = `${base}.html`;
    try {
      await writeFile(paths.page_html_path, await page.content());
    } catch (error) {
      logs.cleanup_failures.push({ resource: "page_content", error: String(error) });
    }
  }
  return paths;
}

function available(bytes) {
  return { state: "available", bytes, reason: null };
}

function unavailable(reason) {
  return { state: "unavailable", bytes: null, reason };
}

async function heapSnapshot(session) {
  if (!session) return { js_heap_used_bytes: unavailable("CDP session unavailable"), js_heap_total_bytes: unavailable("CDP session unavailable"), embedder_heap_used_bytes: unavailable("CDP does not expose this metric"), backing_storage_bytes: unavailable("CDP does not expose this metric") };
  try {
    const heap = await session.send("Runtime.getHeapUsage");
    return {
      js_heap_used_bytes: Number.isFinite(heap.usedSize) ? available(heap.usedSize) : unavailable("CDP Runtime.getHeapUsage omitted usedSize"),
      js_heap_total_bytes: Number.isFinite(heap.totalSize) ? available(heap.totalSize) : unavailable("CDP Runtime.getHeapUsage omitted totalSize"),
      embedder_heap_used_bytes: unavailable("CDP Runtime.getHeapUsage does not expose embedder heap usage"),
      backing_storage_bytes: unavailable("CDP Runtime.getHeapUsage does not expose backing storage"),
    };
  } catch (error) {
    const reason = `CDP Runtime.getHeapUsage unavailable: ${String(error)}`;
    return { js_heap_used_bytes: unavailable(reason), js_heap_total_bytes: unavailable(reason), embedder_heap_used_bytes: unavailable(reason), backing_storage_bytes: unavailable(reason) };
  }
}

function isGraphRequest(item, apiUrl) {
  return item.url.startsWith(apiUrl) && new URL(item.url).pathname.startsWith("/api/graph/");
}

async function runCameraSequence(input) {
  const box = await page.locator("#graph-root canvas").first().boundingBox();
  if (!box) throw new Error("empty_visual_output: no canvas bounding box");
  const x = Math.round(box.x + box.width / 2);
  const y = Math.round(box.y + box.height / 2);
  const sequence = [{ type: "move", x, y }];
  await page.mouse.move(x, y);
  await page.mouse.down();
  sequence.push({ type: "down", x, y });
  for (let step = 1; step <= input.drag_steps; step += 1) {
    const point = { x: x + (input.drag_dx * step) / input.drag_steps, y: y + (input.drag_dy * step) / input.drag_steps };
    await page.mouse.move(point.x, point.y);
    sequence.push({ type: "drag_move", ...point, step, delay_ms: input.step_delay_ms });
    if (input.step_delay_ms) await page.waitForTimeout(input.step_delay_ms);
  }
  await page.mouse.up();
  sequence.push({ type: "up", x: x + input.drag_dx, y: y + input.drag_dy });
  await page.mouse.wheel(0, input.zoom_in_delta_y);
  sequence.push({ type: "wheel", delta_x: 0, delta_y: input.zoom_in_delta_y, delay_ms: input.wheel_delay_ms });
  if (input.wheel_delay_ms) await page.waitForTimeout(input.wheel_delay_ms);
  await page.mouse.wheel(0, input.zoom_out_delta_y);
  sequence.push({ type: "wheel", delta_x: 0, delta_y: input.zoom_out_delta_y, delay_ms: input.wheel_delay_ms });
  return { viewport: control.browser.viewport, device_scale_factor: control.browser.device_scale_factor, sequence };
}

try {
  if (!controlPath || !resultPath) throw new Error("harness_protocol_failure: expected control and result paths");
  control = JSON.parse(await readFile(controlPath, "utf8"));
  const fixture = createFixture(control.fixture);
  const quiescenceMs = control.quiescence_ms ?? 100;
  const animationDurationMs = control.animation_duration_ms ?? 250;
  const frameBudgetMs = control.frame_budget_ms ?? 16.7;
  const minimumFrameSampleCount = control.minimum_frame_sample_count ?? 1;
  const input = control.input ?? { drag_dx: 36, drag_dy: 18, drag_steps: 6, step_delay_ms: 30, zoom_in_delta_y: -80, zoom_out_delta_y: 80, wheel_delay_ms: 35 };
  if (![quiescenceMs, animationDurationMs, frameBudgetMs, minimumFrameSampleCount].every((value) => Number.isFinite(value) && value > 0) || !Number.isInteger(minimumFrameSampleCount) || !Number.isInteger(input.drag_steps) || input.drag_steps < 1 || ![input.drag_dx, input.drag_dy, input.step_delay_ms, input.zoom_in_delta_y, input.zoom_out_delta_y, input.wheel_delay_ms].every(Number.isFinite) || input.step_delay_ms < 0 || input.wheel_delay_ms < 0) throw new Error("invalid_configuration: invalid timing or fixed-input configuration");

  replay = await bounded("replay", () => startReplayServer(fixture));
  stage("replay_ready", replay.apiUrl);
  await bounded("replay_health_node", async () => {
    const response = await fetch(`${replay.apiUrl}/health`);
    if (!response.ok || (await response.json()).api_version !== "1") throw new Error("replay API health contract mismatch");
  });
  web = await bounded("web", () => startPageServer(resolve(control.browser_dist_path)));
  stage("web_ready", web.url);
  browserServer = await bounded("chromium_launch", () => chromium.launchServer({ headless: control.browser.headless, args: control.browser.launch_args }));
  stage("chromium_launched", `pid=${browserServer.process()?.pid ?? "unavailable"}`);
  browser = await bounded("playwright_connect", () => chromium.connect(browserServer.wsEndpoint()));
  stage("playwright_connected");
  const runtimeState = {
    browser_pid: browserServer.process()?.pid ?? null,
    browser_version: browser.version(),
    browser_executable_path: chromium.executablePath() || null,
    replay_url: replay.apiUrl,
    evaluation_page_url: web.url,
    headless: Boolean(control.browser.headless),
    launch_timestamp_utc: new Date().toISOString(),
    phase: "launched", phase_sequence: 0,
  };
  await writeRuntimeState(control.runtime_state_path, runtimeState);
  await writeJson(control.browser_pid_path, { browser_pid: runtimeState.browser_pid });
  context = await bounded("context", () => browser.newContext({ viewport: control.browser.viewport, deviceScaleFactor: control.browser.device_scale_factor, locale: control.browser.locale, timezoneId: control.browser.timezone }));
  stage("context_created");
  const allowedOrigins = new Set([new URL(web.url).origin, new URL(replay.apiUrl).origin]);
  await context.route("**/*", async (route) => {
    const requestUrl = route.request().url();
    let origin;
    try { origin = new URL(requestUrl).origin; } catch { origin = null; }
    if (origin && allowedOrigins.has(origin)) return route.continue();
    logs.unexpected_network.push({ url: requestUrl, method: route.request().method() });
    return route.abort();
  });
  page = await bounded("page", () => context.newPage());
  stage("page_created");
  page.setDefaultTimeout(timeoutMs);
  page.setDefaultNavigationTimeout(timeoutMs);
  page.on("console", (message) => logs.console.push({ type: message.type(), text: message.text() }));
  page.on("pageerror", (error) => logs.page_errors.push(String(error)));
  page.on("request", (request) => logs.requests.push({ url: request.url(), method: request.method() }));
  page.on("response", (response) => logs.responses.push({ url: response.url(), status: response.status(), timing: response.request().timing() }));
  page.on("requestfailed", (request) => logs.failures.push({ url: request.url(), failure: request.failure() }));
  page.on("crash", () => logs.page_errors.push("page_crash"));
  page.on("close", () => logs.page_errors.push("page_close"));

  stage("navigation_start", web.url);
  await withTimeout("navigation", timeoutMs, () => page.goto(web.url, { waitUntil: "domcontentloaded" }));
  stage("domcontentloaded");
  await bounded("bootstrap", () => page.waitForFunction(() => document.documentElement.dataset.rq2Bootstrap === "ready"));
  stage("bootstrap_ready");
  cdp = await bounded("cdp", () => context.newCDPSession(page));
  await setMeasurementPhase(runtimeState, "baseline");
  const heapBaseline = await bounded("heap_baseline", () => heapSnapshot(cdp));
  await bounded("replay_health_page", () => page.evaluate(async (apiUrl) => {
    const response = await fetch(`${apiUrl}/health`);
    const payload = await response.json();
    if (!response.ok || payload.api_version !== "1") throw new Error("replay health contract mismatch");
  }, replay.apiUrl));
  stage("replay_health_ok");
  stage("view_create_start");
  await bounded("view_create", () => page.evaluate((apiUrl) => window.phyloLensEvaluation?.createView(apiUrl), replay.apiUrl));
  stage("view_created");
  stage("load_start");
  await setMeasurementPhase(runtimeState, "load_render");
  const result = await bounded("view_load_and_raf", () => page.evaluate(async (config) => window.phyloLensEvaluation?.run(config), {
    kind: "rq2-run", apiUrl: replay.apiUrl, labelsEnabled: control.fixture.labelsEnabled ?? control.fixture.labels_enabled,
  }));
  if (!result?.ok) throw new Error(`client_load_failure: ${result?.error ?? "missing page result"}`);
  stage("load_resolved");
  stage("raf_1");
  stage("raf_2");
  if (!result.visualOutput) throw new Error("empty_visual_output");
  stage("canvas_validated");
  await bounded("quiescence", () => page.waitForTimeout(quiescenceMs));
  const heapPostRender = await bounded("heap_post_render", () => heapSnapshot(cdp));
  await setMeasurementPhase(runtimeState, "post_render");

  const graphResponsesBeforeCamera = logs.responses.filter((item) => isGraphRequest(item, replay.apiUrl)).length;
  stage("frame_sampling_start");
  await setMeasurementPhase(runtimeState, "frame_experiment");
  await bounded("frame_sampling_setup", () => page.evaluate(() => window.phyloLensEvaluation?.startFrameSampling()));
  const inputRecord = await bounded("camera_sequence", () => runCameraSequence(input));
  const frameIntervalsMs = await bounded("frame_sampling_finish", () => page.evaluate(() => window.phyloLensEvaluation?.finishFrameSampling()));
  stage("frame_sampling_complete", `samples=${frameIntervalsMs.length}`);
  const graphResponsesAfterCamera = logs.responses.filter((item) => isGraphRequest(item, replay.apiUrl)).length;
  const unexpectedViewportRequests = graphResponsesAfterCamera - graphResponsesBeforeCamera;
  const replayContractFailure = replay.accessLog.some((item) => item.status >= 400);
  const resourceTimings = await bounded("resource_timings", () => page.evaluate(() => performance.getEntriesByType("resource").map((entry) => entry.toJSON())));
  await writeJson(control.frame_samples_path, { frame_intervals_ms: frameIntervalsMs });
  await writeJson(control.request_samples_path, { requests: logs.requests, responses: logs.responses, resource_timings: resourceTimings, failures: logs.failures, unexpected_network: logs.unexpected_network });
  await writeJson(control.replay_access_log_path, replay.accessLog);
  await bounded("screenshot", () => page.screenshot({ path: resolve(control.screenshot_path) }));
  stage("screenshot_written");
  await bounded("view_dispose", () => page.evaluate(() => window.phyloLensEvaluation?.dispose()));

  const validity = observationValidity({ unexpectedNetworkCount: logs.unexpected_network.length, unexpectedViewportRequests, frameSampleCount: frameIntervalsMs.length, minimumFrameSampleCount, replayContractFailure });
  stage("result_emitted");
  const output = {
    status: validity.status,
    failure_kind: validity.failure_kind,
    message: validity.failure_kind === "replay_contract_failure" ? "replay_contract_failure: replay returned an unsupported or malformed response" : validity.failure_kind === "none" ? null : `${validity.failure_kind}: ${validity.failure_kind === "unexpected_viewport_request" ? unexpectedViewportRequests : logs.unexpected_network.length}`,
    last_completed_stage: lastStage,
    elapsed_ms: performance.now() - started,
    timing: {
      t0_ms: result.t0, t1_ms: result.t1, t2_ms: result.t2,
      load_to_snapshot_applied_ms: result.t1 - result.t0,
      load_to_post_update_frame_ms: result.t2 - result.t0,
      snapshot_applied_to_frame_ms: result.t2 - result.t1,
    },
    heap: { baseline: heapBaseline, post_render: heapPostRender },
    frame_intervals_ms: frameIntervalsMs,
    frame_budget_ms: frameBudgetMs,
    minimum_frame_sample_count: minimumFrameSampleCount,
    input_record: inputRecord,
    fixture,
    runtime_state: runtimeState,
    visual_output: { canvas_nonzero: true },
    replay_request_count: replay.accessLog.length,
    initial_viewport_request_count: graphResponsesBeforeCamera,
    post_initial_viewport_request_count: unexpectedViewportRequests,
    diagnostics: logs,
    resource_timings: resourceTimings,
    replay_access_log: replay.accessLog,
    artifacts: { screenshot_path: control.screenshot_path, frame_samples_path: control.frame_samples_path ?? null, request_samples_path: control.request_samples_path ?? null, replay_access_log_path: control.replay_access_log_path ?? null },
  };
  await writeFile(resultPath, JSON.stringify(output, null, 2));
  emit(output);
} catch (error) {
  const artifacts = await retainDiagnostics().catch((artifactError) => ({ diagnostics_error: String(artifactError) }));
  const failure = {
    status: error?.code === "STAGE_TIMEOUT" ? "timeout" : "failure",
    failure_kind: classifyFailure(error, lastStage), message: String(error), last_completed_stage: lastStage,
    elapsed_ms: performance.now() - started, partial_timing_data: null,
    diagnostic_artifacts: { result_path: resultPath ?? null, screenshot_path: control?.screenshot_path ?? null, ...artifacts },
  };
  if (resultPath) { await mkdir(dirname(resultPath), { recursive: true }); await writeFile(resultPath, JSON.stringify(failure, null, 2)); }
  emit(failure);
} finally {
  await closeAll([["page", page], ["context", context], ["browser", browser], ["browser_server", browserServer], ["web", web], ["replay", replay]], (resource, error) => logs.cleanup_failures.push({ resource, error: String(error) }));
  stage("cleanup_complete");
}

async function startPageServer(root) {
  const server = createServer((request, response) => {
    const relative = request.url === "/" ? "index.html" : request.url.split("?")[0].replace(/^\//, "");
    const file = resolve(root, relative);
    if (!file.startsWith(root)) { response.writeHead(403); return response.end(); }
    const type = file.endsWith(".js") ? "text/javascript" : file.endsWith(".html") ? "text/html" : "application/octet-stream";
    response.setHeader("content-type", type);
    createReadStream(file).on("error", () => { response.writeHead(404); response.end(); }).pipe(response);
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address();
  return { url: `http://127.0.0.1:${address.port}`, close: () => new Promise((resolve) => server.close(resolve)) };
}
