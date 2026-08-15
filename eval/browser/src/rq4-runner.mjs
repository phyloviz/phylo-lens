/* Real-server RQ4 browser child. stdout contains one structured result only. */
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { chromium } from "@playwright/test";

const [controlPath, resultPath] = process.argv.slice(2);
let browser;
let context;
let page;
let web;
let operationNetworkRequests = [];
let collectingOperationNetwork = false;
let progress = {};

async function staticServer({ directory, webPort }) {
  const server = createServer(async (request, response) => {
    const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    const file = resolve(directory, path === "/" ? "index.html" : `.${path}`);
    try {
      const body = await readFile(file);
      const contentType = file.endsWith(".js")
        ? "text/javascript"
        : file.endsWith(".css")
          ? "text/css"
          : "text/html";
      response.writeHead(200, {
        "content-type": contentType,
      });
      response.end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise((resolveReady) =>
    server.listen(webPort ?? 4173, "127.0.0.1", resolveReady),
  );
  const address = server.address();
  return { server, url: `http://127.0.0.1:${address.port}` };
}

async function waitForEvent(reason, clusterId, timeoutMs) {
  await page.waitForFunction(
    ({ expectedReason, expectedCluster }) =>
      window.phyloLensEvaluation?.rq4?.observerEvents().some((event) => {
        const item = event;
        return (
          item.boundary?.reason === expectedReason &&
          (expectedCluster == null ||
            item.boundary?.clusterId === expectedCluster)
        );
      }),
    { expectedReason: reason, expectedCluster: clusterId },
    { timeout: timeoutMs },
  );
  const events = await page.evaluate(
    () => window.phyloLensEvaluation?.rq4?.observerEvents() ?? [],
  );
  return events
    .filter(
      (event) =>
        event.boundary?.reason === reason &&
        (clusterId == null || event.boundary?.clusterId === clusterId),
    )
    .at(-1);
}

function targetFrom(initial, requestedId) {
  const targets = initial?.diagnostics?.aggregateTargets ?? [];
  const selected = requestedId
    ? targets.find((item) => item.clusterId === requestedId)
    : [...targets].sort((a, b) => a.clusterId.localeCompare(b.clusterId))[0];
  if (!selected) throw new Error("no_eligible_target");
  return selected;
}

async function run(control) {
  web = await staticServer({
    directory: control.browser_dist_path,
    webPort: control.web_port,
  });
  browser = await chromium.launch({
    headless: control.browser.headless,
    args: control.browser.launch_args ?? [],
  });
  context = await browser.newContext({
    viewport: control.browser.viewport,
    deviceScaleFactor: control.browser.device_scale_factor,
  });
  page = await context.newPage();
  page.on("request", (request) => {
    if (!collectingOperationNetwork) return;
    operationNetworkRequests.push({
      method: request.method(),
      resourceType: request.resourceType(),
      url: request.url(),
    });
  });
  await page.goto(web.url, { waitUntil: "networkidle" });
  await page.waitForFunction(
    () => document.documentElement.dataset.rq2Bootstrap === "ready",
  );
  await page.evaluate(
    (apiUrl) => window.phyloLensEvaluation?.rq4?.createView(apiUrl),
    control.api_url,
  );
  let initial = await page.evaluate(
    ({ content, name, maxNodes }) =>
      window.phyloLensEvaluation?.rq4?.load(content, name, maxNodes),
    control,
  );
  progress = { ...progress, initial };
  if (!initial?.boundary || initial.boundary.reason !== "initial_load")
    throw new Error("bootstrap_failure");

  await page.waitForTimeout(control.setup_quiescence_ms);

  const settledObserverEvents = await page.evaluate(
    () =>
      window.phyloLensEvaluation?.rq4?.observerEventsWithDiagnostics() ?? [],
  );

  initial =
    settledObserverEvents.find(
      (item) => item.boundary?.sequence === initial.boundary.sequence,
    ) ?? initial;

  progress = { ...progress, initial };

  let target = null;
  let expanded = null;
  if (control.operation !== "viewport_navigation")
    target = targetFrom(initial, control.target_cluster_id);
  if (control.operation === "cluster_collapse") {
    await page.mouse.click(target.clientX, target.clientY);
    expanded = await waitForEvent(
      "cluster_expand",
      target.clusterId,
      control.timeout_ms,
    );
    await page.waitForTimeout(control.setup_quiescence_ms);
  }
  if (control.operation === "viewport_navigation") {
    const canvas = await page
      .locator("#graph-root canvas")
      .first()
      .boundingBox();
    if (!canvas) throw new Error("operation_input_failure");
    await page.mouse.move(
      canvas.x + canvas.width / 2,
      canvas.y + canvas.height / 2,
    );
    for (
      let step = 0;
      step < (control.input.setup_wheel_steps ?? 0);
      step += 1
    ) {
      await page.mouse.wheel(0, control.input.setup_wheel_delta_y);
      await page.waitForTimeout(control.input.setup_wheel_interval_ms ?? 70);
    }
    await page.waitForTimeout(control.setup_quiescence_ms);
  }
  await page.evaluate(() => window.phyloLensEvaluation?.startFrameSampling());
  operationNetworkRequests = [];
  collectingOperationNetwork = true;
  const operationStart = await page.evaluate(() =>
    window.phyloLensEvaluation?.rq4?.beginOperation(),
  );
  const t0 = operationStart.t0;
  if (control.operation === "viewport_navigation") {
    const canvas = await page
      .locator("#graph-root canvas")
      .first()
      .boundingBox();
    progress = { ...progress, canvas };
    if (!canvas) throw new Error("operation_input_failure");
    await page.mouse.move(
      canvas.x + canvas.width / 2,
      canvas.y + canvas.height / 2,
    );
    if (control.input.kind === "stage_double_click") {
      await page.mouse.dblclick(
        canvas.x + control.input.client_x,
        canvas.y + control.input.client_y,
      );
    } else {
      await page.mouse.wheel(0, control.input.wheel_delta_y);
    }
  } else if (control.operation === "cluster_expand") {
    await page.mouse.click(target.clientX, target.clientY);
  } else {
    await page.mouse.dblclick(target.clientX, target.clientY);
  }
  const reason =
    control.operation === "viewport_navigation"
      ? "viewport_sync"
      : control.operation;
  const event = await waitForEvent(
    reason,
    target?.clusterId ?? null,
    control.timeout_ms,
  );
  progress = { ...progress, event };
  const t4 = await page.evaluate(
    (sequence) => window.phyloLensEvaluation?.rq4?.finishAtFrame(sequence),
    event.boundary.sequence,
  );
  const frames = await page.evaluate(() =>
    window.phyloLensEvaluation?.finishFrameSampling(),
  );
  const trace = await page.evaluate(
    () => window.phyloLensEvaluation?.rq4?.requestTrace() ?? [],
  );
  const observerEvents = await page.evaluate(
    () =>
      window.phyloLensEvaluation?.rq4?.observerEventsWithDiagnostics() ?? [],
  );
  initial =
    observerEvents.find(
      (item) => item.boundary?.sequence === initial.boundary.sequence,
    ) ?? initial;
  const completedEvent =
    observerEvents.find(
      (item) => item.boundary?.sequence === event.boundary.sequence,
    ) ?? event;
  expanded =
    (expanded &&
      (observerEvents.find(
        (item) => item.boundary?.sequence === expanded.boundary.sequence,
      ) ??
        expanded)) ||
    null;
  const operationTrace = await page.evaluate(
    () => window.phyloLensEvaluation?.rq4?.operationRequestTrace() ?? [],
  );
  collectingOperationNetwork = false;
  const relevant = operationTrace.filter(
    (item) =>
      item.url.startsWith(control.api_url) &&
      new URL(item.url).pathname === "/api/graph/viewport" &&
      (control.operation !== "cluster_expand" ||
        item.body?.cluster_id === target.clusterId),
  );
  if (control.screenshot_path)
    await page.screenshot({ path: control.screenshot_path });
  return {
    status: "success",
    operation: control.operation,
    web_origin: web.url,
    browser: {
      version: browser.version(),
      executable_path: chromium.executablePath(),
      headless: control.browser.headless,
      viewport: control.browser.viewport,
      device_scale_factor: control.browser.device_scale_factor,
      launch_args: control.browser.launch_args ?? [],
    },
    t0,
    clock_domain: "browser_performance_now",
    t3: completedEvent.timestamp,
    t4,
    initial,
    event: completedEvent,
    target,
    observer_events: observerEvents,
    request_trace: trace,
    operation_request_trace: operationTrace,
    operation_network_requests: operationNetworkRequests,
    pre_expansion: control.operation === "cluster_collapse" ? initial : null,
    expanded,
    relevant_requests: relevant,
    frame_intervals_ms: frames,
    viewport_state:
      control.operation === "viewport_navigation"
        ? {
            before: operationStart.viewport,
            after: completedEvent.diagnostics?.viewport ?? null,
            input: control.input,
          }
        : null,
  };
}

try {
  const control = JSON.parse(await readFile(controlPath, "utf8"));
  const result = await run(control);
  await mkdir(dirname(resultPath), { recursive: true });
  await writeFile(resultPath, JSON.stringify(result, null, 2));
  process.stdout.write(`${JSON.stringify(result)}\n`);
} catch (error) {
  const result = {
    status: "failure",
    failure_kind: String(error).includes("no_eligible_target")
      ? "no_eligible_target"
      : "harness_protocol_failure",
    error: String(error),
    ...progress,
  };
  if (resultPath) {
    await mkdir(dirname(resultPath), { recursive: true });
    await writeFile(resultPath, JSON.stringify(result, null, 2));
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  collectingOperationNetwork = false;
  await Promise.allSettled([
    page?.close(),
    context?.close(),
    browser?.close(),
    web?.server?.close?.(),
  ]);
}
