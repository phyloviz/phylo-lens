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

async function eventFor(
  reason,
  clusterId,
  timeout,
  afterSequence = -1,
  requireNativeInput = false,
) {
  await page.waitForFunction(
    ({ reason, clusterId, afterSequence, requireNativeInput }) =>
      (window.phyloLensEvaluation?.rq4?.observerEvents() ?? []).some(
        (item) =>
          item.boundary?.sequence > afterSequence &&
          (!requireNativeInput ||
            (item.timestamp >=
              window.phyloLensEvaluation.rq4.inputEvent()?.timestamp &&
              (reason !== "viewport_sync" ||
                window.phyloLensEvaluation.rq4
                  .operationRequestTrace()
                  .some(
                    (request) =>
                      request.fetchInvocationTimestamp >=
                        window.phyloLensEvaluation.rq4.inputEvent()
                          ?.timestamp &&
                      request.responseTimestamp <= item.timestamp,
                  )))) &&
          item.boundary?.reason === reason &&
          (clusterId == null || item.boundary?.clusterId === clusterId),
      ),
    { reason, clusterId, afterSequence, requireNativeInput },
    { timeout },
  );
  const events = await page.evaluate(
    () =>
      window.phyloLensEvaluation?.rq4?.observerEventsWithDiagnostics() ?? [],
  );
  const input = requireNativeInput
    ? await page.evaluate(() => window.phyloLensEvaluation.rq4.inputEvent())
    : null;
  const requests = requireNativeInput
    ? await page.evaluate(() =>
        window.phyloLensEvaluation.rq4.operationRequestTrace(),
      )
    : [];
  return events
    .filter(
      (item) =>
        item.boundary?.sequence > afterSequence &&
        (!requireNativeInput ||
          (item.timestamp >= input.timestamp &&
            (reason !== "viewport_sync" ||
              requests.some(
                (request) =>
                  request.fetchInvocationTimestamp >= input.timestamp &&
                  request.responseTimestamp <= item.timestamp,
              )))) &&
        item.boundary?.reason === reason &&
        (clusterId == null || item.boundary?.clusterId === clusterId),
    )
    .at(0);
}

function targetFor(initial, expected) {
  const item = initial?.diagnostics?.aggregateTargets?.find(
    (x) => x.clusterId === expected.cluster_id,
  );
  if (!item) throw new Error("target_not_found");
  if (
    item.representedNodeCount !== expected.represented_member_count ||
    (expected.compact_structural_fingerprint &&
      item.structuralFingerprint !== expected.compact_structural_fingerprint)
  )
    throw new Error("target_semantics_mismatch");
  return item;
}

async function run(control) {
  web = await staticServer(control.browser_dist_path, control.web_port);

  browser = await chromium.launch({
    headless: control.local_development
      ? (control.browser.headless ?? false)
      : false,
    executablePath: control.browser.executable_path || undefined,
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
      control.local_development ||
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
  if (control.local_development) {
    await page.evaluate(
      (query) => window.phyloLensEvaluation?.rq4?.configureLocalCapture(query),
      control.initial_query,
    );
  }
  await page.evaluate(
    (api) => window.phyloLensEvaluation?.rq4?.createView(api),
    control.api_url,
  );
  if (control.integrated_rq2) {
    const cdp = await context.newCDPSession(page);
    const heapBefore = await cdp.send("Runtime.getHeapUsage");
    const first = await page.evaluate(async ({ content, name }) => {
      const harness = window.phyloLensEvaluation;
      harness.startFrameSampling();
      const t0 = performance.now();
      const initial = await harness.rq4.load(content, name);
      const t1 = performance.now();
      const t2 = await new Promise((resolve) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => resolve(performance.now())),
        ),
      );
      return { t0, t1, t2, initial, frames: harness.finishFrameSampling(t2) };
    }, control);
    await page.waitForTimeout(100);
    const heapAfter = await cdp.send("Runtime.getHeapUsage");
    const traces = await page.evaluate(() =>
      window.phyloLensEvaluation.rq4.requestTrace(),
    );
    const gpu = await page.evaluate(() =>
      window.phyloLensEvaluation.rq4.gpuEvidence(),
    );
    if (!gpu.hardware_accelerated) throw new Error("gpu_provenance_rejected");
    return {
      status: "success",
      first,
      request_trace: traces,
      gpu,
      browser: {
        version: browser.version(),
        playwright_version: playwrightVersion,
        viewport: control.browser.viewport,
        device_scale_factor: control.browser.device_scale_factor,
      },
      heap: {
        baseline: heapBefore,
        post: heapAfter,
        delta_bytes: heapAfter.usedSize - heapBefore.usedSize,
      },
      frame_intervals_ms: first.frames,
    };
  }
  let initial = await page.evaluate(
    ({ content, name, maxNodes }) =>
      window.phyloLensEvaluation?.rq4?.load(content, name, maxNodes),
    control,
  );
  if (
    !initial?.boundary ||
    (!control.local_development && initial.boundary.reason !== "initial_load")
  )
    throw new Error("bootstrap_failure");
  if (control.local_development && (control.target_rank || control.target)) {
    await page.evaluate(
      (preserve) =>
        window.phyloLensEvaluation?.rq4?.prepareLocalExpansion(preserve),
      Boolean(control.target),
    );
  }
  await page.waitForTimeout(control.setup_quiescence_ms);
  let all = await page.evaluate(
    () =>
      window.phyloLensEvaluation?.rq4?.observerEventsWithDiagnostics() ?? [],
  );
  initial = control.local_development
    ? (all.at(-1) ?? initial)
    : (all.find((x) => x.boundary?.sequence === initial.boundary.sequence) ??
      initial);
  progress = { initial };
  const gpu = await page.evaluate(() =>
    window.phyloLensEvaluation?.rq4?.gpuEvidence(),
  );
  if (
    !control.local_development &&
    (!gpu?.hardware_accelerated || gpu.backend !== "Metal")
  )
    throw new Error("gpu_provenance_rejected");
  let target = null,
    preOperation = initial;
  if (control.local_development && control.target_rank) {
    const box = await page.locator("#graph-root").boundingBox();
    const candidates = (initial.diagnostics?.aggregateTargets ?? [])
      .filter(
        (x) =>
          x.representedNodeCount > 1 &&
          box &&
          x.clientX > box.x + 5 &&
          x.clientX < box.x + box.width - 5 &&
          x.clientY > box.y + 5 &&
          x.clientY < box.y + box.height - 5,
      )
      .sort(
        (a, b) =>
          a.representedNodeCount - b.representedNodeCount ||
          a.clusterId.localeCompare(b.clusterId),
      );
    if (!candidates.length)
      throw new Error("target_not_found_in_local_viewport");
    const index =
      control.target_rank === "low"
        ? 0
        : control.target_rank === "high"
          ? candidates.length - 1
          : Math.floor(candidates.length / 2);
    target = candidates[index];
  } else if (control.target) target = targetFor(initial, control.target);
  if (target && !control.target?.controlled_setup) {
    // Selection is a Sigma clickNode interaction; expansionControl only
    // invokes the public expand/collapse API for the already selected group.
    await page.mouse.click(target.clientX, target.clientY);
    await page.waitForTimeout(100);
  }
  if (control.operation === "cluster_collapse") {
    const input = await page.evaluate(
      (id) =>
        window.phyloLensEvaluation.rq4.expansionControl(id, "cluster_expand"),
      target.clusterId,
    );
    await page.mouse.click(input.clientX, input.clientY);
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
  if (control.operation !== "viewport_navigation") {
    const input = await page.evaluate(
      ({ id, operation }) =>
        window.phyloLensEvaluation.rq4.expansionControl(id, operation),
      { id: target.clusterId, operation: control.operation },
    );
    target = { ...target, ...input };
    const controlButton = page.locator("#expansion-action");
    await controlButton.waitFor({ state: "visible" });
    const controlBox = await controlButton.boundingBox();
    if (!controlBox) throw new Error("operation_input_failure");
    target.clientX = controlBox.x + controlBox.width / 2;
    target.clientY = controlBox.y + controlBox.height / 2;
  }
  await page.evaluate(() => window.phyloLensEvaluation?.startFrameSampling());
  responseMetadata = [];
  collectResponses = true;
  const inputSpecification =
    control.operation === "cluster_collapse"
      ? {
          eventType: "click",
          nativeEventType: "click",
          clickCount: 1,
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
            eventType: control.local_development ? "wheel" : "dblclick",
            nativeEventType: control.local_development ? "wheel" : "dblclick",
            clickCount: control.local_development ? null : 2,
            clientX: canvas.x + control.input.client_x,
            clientY: canvas.y + control.input.client_y,
            targetClusterId: null,
          };
  await page.evaluate(
    (specification) => window.phyloLensEvaluation?.rq4?.armInput(specification),
    inputSpecification,
  );
  if (control.operation === "viewport_navigation") {
    if (control.local_development) {
      await page.mouse.move(
        canvas.x + control.input.client_x,
        canvas.y + control.input.client_y,
      );
      await page.mouse.wheel(0, -500);
    } else {
      await page.mouse.dblclick(
        canvas.x + control.input.client_x,
        canvas.y + control.input.client_y,
      );
    }
  } else {
    await page.locator("#expansion-action").click();
  }

  const reason =
    control.operation === "viewport_navigation"
      ? "viewport_sync"
      : control.operation;

  if (control.local_development) {
    progress = {
      ...progress,
      input_event: await page.evaluate(() =>
        window.phyloLensEvaluation?.rq4?.inputEvent(),
      ),
      request_trace: await page.evaluate(() =>
        window.phyloLensEvaluation?.rq4?.operationRequestTrace(),
      ),
    };
  }
  const event = await eventFor(
    reason,
    target?.clusterId ?? null,
    control.timeout_ms,
    control.local_development ? preOperation.boundary.sequence : -1,
    true,
  );
  const settled = await page.evaluate(
    (sequence) => window.phyloLensEvaluation?.rq4?.finishAtFrame(sequence),
    event.boundary.sequence,
  );
  const frames = await page.evaluate(
    (end) => window.phyloLensEvaluation?.finishFrameSampling(end),
    settled,
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
        typeof x.responseTimestamp === "number" &&
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
    interaction_protocol: control.local_development
      ? "local-development-expansion-v1"
      : "explicit-expansion-v1",
    browser: {
      version: browser.version(),
      executable_path:
        control.browser.executable_path || chromium.executablePath(),
      playwright_version: playwrightVersion,
      headless: control.local_development
        ? (control.browser.headless ?? false)
        : false,
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
    timer_trace: control.local_development
      ? await page.evaluate(() => window.phyloLensEvaluation.rq4.timerTrace())
      : [],
    response_metadata: control.local_development
      ? traces
          .filter((x) => x.responseMetadata)
          .map((x) => ({ url: x.url, ...x.responseMetadata }))
      : responseMetadata,
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
