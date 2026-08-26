/* Final RQ4 browser child.  It writes one complete result before shutdown. */
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import { chromium } from "@playwright/test";

const require = createRequire(import.meta.url);
const playwrightVersion = require("@playwright/test/package.json").version;
const [controlPath, resultPath] = process.argv.slice(2);
let browser, context, page, web;
let progress = {};
let collectResponses = false;
let responseMetadata = [];
let pageErrors = [];
let pendingResponseBodies = [];

async function staticServer(directory, port) {
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    const file = resolve(
      directory,
      pathname === "/" ? "index.html" : `.${pathname}`,
    );
    try {
      const body = await readFile(file);
      response.writeHead(200, {
        "content-type": file.endsWith(".js")
          ? "text/javascript"
          : file.endsWith(".css")
            ? "text/css"
            : "text/html",
      });
      response.end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((done) => server.listen(port, "127.0.0.1", done));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

async function eventFor(reason, clusterId, timeout) {
  await page.waitForFunction(
    ({ reason, clusterId }) =>
      (window.phyloLensEvaluation?.rq4?.observerEvents() ?? []).some(
        (item) =>
          item.boundary?.reason === reason &&
          (clusterId == null || item.boundary?.clusterId === clusterId),
      ),
    { reason, clusterId },
    { timeout },
  );
  const events = await page.evaluate(
    () =>
      window.phyloLensEvaluation?.rq4?.observerEventsWithDiagnostics() ?? [],
  );
  return events
    .filter(
      (item) =>
        item.boundary?.reason === reason &&
        (clusterId == null || item.boundary?.clusterId === clusterId),
    )
    .at(-1);
}

function targetFor(initial, expected) {
  const item = initial?.diagnostics?.aggregateTargets?.find(
    (x) => x.clusterId === expected.cluster_id,
  );
  if (!item) throw new Error("target_not_found");
  if (
    item.representedNodeCount !== expected.represented_member_count ||
    item.structuralFingerprint !== expected.compact_structural_fingerprint
  )
    throw new Error("target_semantics_mismatch");
  return item;
}

async function run(control) {
  web = await staticServer(control.browser_dist_path, control.web_port);
  browser = await chromium.launch({
    headless: false,
    args: control.browser.launch_args ?? [],
  });
  context = await browser.newContext({
    viewport: control.browser.viewport,
    deviceScaleFactor: control.browser.device_scale_factor,
    locale: control.browser.locale,
    timezoneId: control.browser.timezone,
  });
  page = await context.newPage();
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") pageErrors.push(message.text());
  });
  page.on("response", (response) => {
    if (
      !collectResponses ||
      new URL(response.url()).pathname !== "/api/graph/viewport"
    )
      return;
    const body = response
      .json()
      .then((body) => {
        responseMetadata.push({
          url: response.url(),
          status: response.status(),
          node_count: Array.isArray(body?.nodes) ? body.nodes.length : null,
          edge_count: Array.isArray(body?.edges) ? body.edges.length : null,
          total_node_count: body?.total_node_count ?? null,
          truncated: body?.truncated ?? null,
          lod_level: body?.lod_level ?? null,
          layout_version: body?.layout_version ?? null,
        });
      })
      .catch((error) => pageErrors.push(`viewport response parse: ${error}`));
    pendingResponseBodies.push(body);
  });
  const preparation = {
    job_id: "rq4-final-prepared-layout",
    status: "ready",
    result: control.prepared_result,
  };
  await page.route("**/api/graph/prepare", async (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        job_id: preparation.job_id,
        status: "pending",
        dataset_id: control.prepared_result.dataset_id,
      }),
    }),
  );
  await page.route(
    "**/api/graph/prepare/rq4-final-prepared-layout",
    async (route) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(preparation),
      }),
  );
  await page.goto(web.url, { waitUntil: "networkidle" });
  await page.waitForFunction(
    () => document.documentElement.dataset.rq2Bootstrap === "ready",
  );
  await page.evaluate(
    (api) => window.phyloLensEvaluation?.rq4?.createView(api),
    control.api_url,
  );
  let initial = await page.evaluate(
    ({ content, name, maxNodes }) =>
      window.phyloLensEvaluation?.rq4?.load(content, name, maxNodes),
    control,
  );
  if (!initial?.boundary || initial.boundary.reason !== "initial_load")
    throw new Error("bootstrap_failure");
  await page.waitForTimeout(control.setup_quiescence_ms);
  let all = await page.evaluate(
    () =>
      window.phyloLensEvaluation?.rq4?.observerEventsWithDiagnostics() ?? [],
  );
  initial =
    all.find((x) => x.boundary?.sequence === initial.boundary.sequence) ??
    initial;
  progress = { initial };
  const gpu = await page.evaluate(() =>
    window.phyloLensEvaluation?.rq4?.gpuEvidence(),
  );
  if (!gpu?.hardware_accelerated || gpu.backend !== "Metal")
    throw new Error("gpu_provenance_rejected");
  let target = null,
    preOperation = initial;
  if (control.target) target = targetFor(initial, control.target);
  if (control.operation === "cluster_collapse") {
    await page.mouse.click(target.clientX, target.clientY);
    preOperation = await eventFor(
      "cluster_expand",
      target.clusterId,
      control.timeout_ms,
    );
    await page.waitForTimeout(control.setup_quiescence_ms);
  }
  const baseline = await page.evaluate(
    (count) => window.phyloLensEvaluation?.rq4?.baselineFrames(count),
    control.baseline_frame_sample_count,
  );
  const canvas = await page.locator("#graph-root canvas").first().boundingBox();
  if (!canvas) throw new Error("operation_input_failure");
  await page.evaluate(() => window.phyloLensEvaluation?.startFrameSampling());
  responseMetadata = [];
  collectResponses = true;
  const inputSpecification =
    control.operation === "cluster_collapse"
      ? {
          eventType: "dblclick",
          nativeEventType: "click",
          clickCount: 2,
          clientX: target.clientX,
          clientY: target.clientY,
          targetClusterId: target.clusterId,
        }
      : control.operation === "cluster_expand"
        ? {
            eventType: "click",
            nativeEventType: "click",
            clickCount: 1,
            clientX: target.clientX,
            clientY: target.clientY,
            targetClusterId: target.clusterId,
          }
        : {
            eventType: "dblclick",
            nativeEventType: "dblclick",
            clickCount: 2,
            clientX: canvas.x + control.input.client_x,
            clientY: canvas.y + control.input.client_y,
            targetClusterId: null,
          };
  await page.evaluate(
    (specification) => window.phyloLensEvaluation?.rq4?.armInput(specification),
    inputSpecification,
  );
  if (control.operation === "viewport_navigation")
    await page.mouse.dblclick(
      canvas.x + control.input.client_x,
      canvas.y + control.input.client_y,
    );
  else if (control.operation === "cluster_expand")
    await page.mouse.click(target.clientX, target.clientY);
  else await page.mouse.dblclick(target.clientX, target.clientY);
  const reason =
    control.operation === "viewport_navigation"
      ? "viewport_sync"
      : control.operation;
  const event = await eventFor(
    reason,
    target?.clusterId ?? null,
    control.timeout_ms,
  );
  const settled = await page.evaluate(
    (sequence) => window.phyloLensEvaluation?.rq4?.finishAtFrame(sequence),
    event.boundary.sequence,
  );
  const frames = await page.evaluate(() =>
    window.phyloLensEvaluation?.finishFrameSampling(),
  );
  const input = await page.evaluate(() =>
    window.phyloLensEvaluation?.rq4?.inputEvent(),
  );
  const traces = await page.evaluate(
    () => window.phyloLensEvaluation?.rq4?.operationRequestTrace() ?? [],
  );
  await Promise.all(pendingResponseBodies);
  collectResponses = false;
  const relevant = traces.filter((x) => {
    try {
      return (
        new URL(x.url).pathname === "/api/graph/viewport" &&
        (!target ||
          control.operation !== "cluster_expand" ||
          x.body?.cluster_id === target.clusterId)
      );
    } catch {
      return false;
    }
  });
  all = await page.evaluate(
    () =>
      window.phyloLensEvaluation?.rq4?.observerEventsWithDiagnostics() ?? [],
  );
  const after =
    all.find((x) => x.boundary?.sequence === event.boundary.sequence) ?? event;
  if (control.screenshot_path)
    await page.screenshot({ path: control.screenshot_path });
  if (pageErrors.length)
    throw new Error(`page_error: ${pageErrors.join(" | ")}`);
  return {
    status: "success",
    clock_domain: "browser_performance_now",
    browser: {
      version: browser.version(),
      executable_path: chromium.executablePath(),
      playwright_version: playwrightVersion,
      headless: false,
      viewport: control.browser.viewport,
      device_scale_factor: control.browser.device_scale_factor,
      locale: control.browser.locale,
      timezone: control.browser.timezone,
    },
    gpu,
    input_event: input,
    t_settled: settled,
    initial,
    pre_operation: preOperation,
    event: after,
    target,
    request_trace: traces,
    relevant_requests: relevant,
    response_metadata: responseMetadata,
    baseline_frame_intervals_ms: baseline,
    frame_intervals_ms: frames,
    viewport_state:
      control.operation === "viewport_navigation"
        ? {
            input: control.input,
            before: initial.diagnostics?.viewport ?? null,
            after: after.diagnostics?.viewport ?? null,
            canvas,
          }
        : null,
  };
}

try {
  const result = await run(JSON.parse(await readFile(controlPath, "utf8")));
  await mkdir(dirname(resultPath), { recursive: true });
  await writeFile(resultPath, JSON.stringify(result, null, 2));
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  const result = {
    status: "failure",
    failure_kind: String(error).match(/target|gpu|bootstrap|input/)
      ? "protocol_failure"
      : "browser_failure",
    error: String(error),
    ...progress,
  };
  if (resultPath) {
    await mkdir(dirname(resultPath), { recursive: true });
    await writeFile(resultPath, JSON.stringify(result, null, 2));
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  collectResponses = false;
  await Promise.allSettled([
    page?.close(),
    context?.close(),
    browser?.close(),
    new Promise((done) => web?.server?.close(done) ?? done()),
  ]);
}
