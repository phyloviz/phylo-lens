/* Current-source comparison; explicit protocol-v2 canvas predicate for PhyloLens. */
import { readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
const [controlFile, resultFile] = process.argv.slice(2);
const control = JSON.parse(await readFile(controlFile, "utf8"));
let web, browser, context, result;
const errors = [],
  blocked = [],
  requests = [];
try {
  web = spawn(
    process.execPath,
    [
      resolve(control.wrapper, "node_modules/vite/bin/vite.js"),
      "--host",
      "127.0.0.1",
      "--port",
      String(control.port),
      "--strictPort",
    ],
    { cwd: control.wrapper, stdio: ["ignore", "pipe", "pipe"] },
  );
  let webLog = "";
  web.stdout.on("data", (c) => (webLog += c));
  web.stderr.on("data", (c) => (webLog += c));
  const url = `http://127.0.0.1:${control.port}`;
  const startup = Date.now();
  while (true) {
    try {
      if ((await fetch(url)).ok) break;
    } catch {
      // The local Vite socket may not be listening during startup.
    }
    if (web.exitCode !== null || Date.now() - startup > 30000)
      throw new Error("Vite startup: " + webLog);
    await new Promise((r) => setTimeout(r, 100));
  }
  browser = await chromium.launch({ headless: false });
  context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    locale: "en-US",
    timezoneId: "UTC",
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("requestfailed", (r) => errors.push(r.failure()?.errorText));
  await page.route("**/*", (route) => {
    const target = route.request().url();
    if (
      target.startsWith(url + "/") ||
      target.startsWith(control.apiUrl || "http://invalid.invalid") ||
      target.startsWith("blob:") ||
      target.startsWith("data:")
    )
      route.continue();
    else {
      blocked.push(target);
      route.abort();
    }
  });
  page.on("response", (response) => {
    if (!response.url().includes("/api/graph/")) return;
    const event = { url: response.url(), status: response.status() };
    requests.push(event);
    response
      .json()
      .then(async (body) => {
        event.node_count =
          body.nodes?.length ?? body.node_count ?? body.result?.node_count;
        event.edge_count =
          body.edges?.length ?? body.edge_count ?? body.result?.edge_count;
        event.payload_bytes =
          Number(response.headers()["content-length"]) || null;
        event.truncated = body.truncated;
        if (
          body.status === "ready" &&
          body.result &&
          control.tool === "phylolens"
        ) {
          await page.evaluate(() =>
            window.__phyloLensAdapter.markPreparationReady({
              visualTimeoutMs: 120000,
            }),
          );
        }
      })
      .catch((e) => errors.push(String(e)));
  });
  await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
  const gpu = await page.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl");
    const d = gl?.getExtension("WEBGL_debug_renderer_info");
    const renderer = d && gl.getParameter(d.UNMASKED_RENDERER_WEBGL);
    return {
      vendor: d && gl.getParameter(d.UNMASKED_VENDOR_WEBGL),
      renderer,
      hardware_accelerated:
        Boolean(renderer) && !/swiftshader|llvmpipe|software/i.test(renderer),
    };
  });
  const newick = await readFile(control.dataset, "utf8");
  await page.waitForFunction(
    (tool) =>
      Boolean(
        window[
          tool === "phylotree"
            ? "__phylotreeAdapter"
            : tool === "taxonium"
              ? "__taxoniumAdapter"
              : "__phyloLensAdapter"
        ]?.loadNewick,
      ),
    control.tool,
  );
  const adapter = await page.evaluate(
    async ({ tool, newick, expected, labels, apiUrl }) => {
      const args = {
        newick,
        expected,
        expectedLabels: labels,
        apiUrl,
        filename: "fullmst.nwk",
        name: expected.name,
        visualTimeoutMs: 120000,
      };
      return window[
        tool === "phylotree"
          ? "__phylotreeAdapter"
          : tool === "taxonium"
            ? "__taxoniumAdapter"
            : "__phyloLensAdapter"
      ].loadNewick(args);
    },
    { ...control, newick },
  );
  if (errors.length || blocked.length)
    throw new Error(JSON.stringify({ errors, blocked }));
  await page.screenshot({ path: control.screenshot });
  result = {
    status: "success",
    adapter,
    gpu,
    requests,
    browser: {
      version: browser.version(),
      executable: chromium.executablePath(),
      viewport: { width: 1440, height: 900 },
      headed: true,
    },
    errors,
    blocked,
  };
} catch (error) {
  result = {
    status: "failure",
    error: String(error),
    errors,
    blocked,
    requests,
  };
} finally {
  if (context) await context.close();
  if (browser) await browser.close();
  if (web && web.exitCode === null) {
    web.kill("SIGTERM");
    await new Promise((r) => web.once("exit", r));
  }
}
await writeFile(resultFile, JSON.stringify(result, null, 2));
