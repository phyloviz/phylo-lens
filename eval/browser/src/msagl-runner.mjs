/* Current-source MSAGLJS native MDS preparation runner; stdout is one JSON row. */
import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

const [corePath, graphPath, timeoutText] = process.argv.slice(2);
const timeoutMs = Number(timeoutText) * 1000;
const graph = await readFile(graphPath, "utf8");
const tileLevelUpperBound = 30;
const tileCapacity = 500;
const nativeMaxMemoryBytes = 4 * 1024 * 1024 * 1024;
const server = createServer((req, res) => {
  if (req.url === "/core.js") return readFile(corePath).then((b) => res.end(b));
  res.end('<script src="/core.js"></script>');
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const lifecycle = {
  chromium_process: "fresh per observation",
  context: "fresh per observation",
  page: "fresh per observation",
  startup_outside_total_ms: true,
};
let browser;
let row;
try {
  browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  page.setDefaultTimeout(timeoutMs);
  await page.goto(`http://127.0.0.1:${port}`);
  row = await page.evaluate(
    ({
      text,
      tileLevelUpperBound: upperBound,
      tileCapacity: capacity,
      nativeMaxMemoryBytes: maxMemoryBytes,
    }) => {
      const M = globalThis.msagl;
      const nodes = new Map();
      const g = new M.Graph();
      const node = (id) =>
        nodes.get(id) ||
        (nodes.set(id, new M.Node(id)),
        g.addNode(nodes.get(id)),
        nodes.get(id));

      // This starts the authoritative timing interval immediately before the
      // adapted payload is consumed by native MSAGLJS graph construction.
      const totalStart = performance.now();
      const parseStart = totalStart;
      for (const line of text.trim().split("\n")) {
        const [a, b] = line.split("\t");
        new M.Edge(node(a), node(b));
      }
      const parseMs = performance.now() - parseStart;

      const geometryStart = performance.now();
      const gg = new M.GeomGraph(g);
      for (const n of g.shallowNodes) {
        const geometryNode = new M.GeomNode(n);
        geometryNode.boundaryCurve =
          M.CurveFactory.mkRectangleWithRoundedCorners(
            30,
            20,
            3,
            3,
            new M.Point(0, 0),
          );
      }
      for (const e of g.deepEdges) new M.GeomEdge(e);
      const geometryMs = performance.now() - geometryStart;

      const settings = new M.MdsLayoutSettings();
      settings.edgeRoutingSettings.EdgeRoutingMode = M.EdgeRoutingMode.Sleeve;
      gg.layoutSettings = settings;
      const phases = {};
      const realTime = console.time;
      const realTimeEnd = console.timeEnd;
      const starts = new Map();
      console.time = (label) => starts.set(label, performance.now());
      console.timeEnd = (label) => {
        if (starts.has(label)) {
          phases[label] =
            (phases[label] || 0) + performance.now() - starts.get(label);
          starts.delete(label);
        }
      };
      const layoutStart = performance.now();
      M.layoutGraphWithMds(gg, null);
      const layoutMs = performance.now() - layoutStart;
      console.time = realTime;
      console.timeEnd = realTimeEnd;

      const box = gg.boundingBox;
      const side = 2 ** Math.ceil(Math.log2(Math.max(box.width, box.height)));
      const rootTile = new M.Rectangle({
        left: box.left - (side - box.width) / 2,
        bottom: box.bottom - (side - box.height) / 2,
        right: box.right + (side - box.width) / 2,
        top: box.top + (side - box.height) / 2,
      });
      const tileMap = new M.TileMap(gg, rootTile, capacity);
      const tilingStart = performance.now();
      const actualLevelsBuilt = tileMap.buildUpToLevel(upperBound);
      const tilingMs = performance.now() - tilingStart;
      const totalMs = performance.now() - totalStart;
      const cdtMs = phases["SleeveRouter CDT"] || 0;
      const routingMs = phases["SleeveRouter routing"] || 0;
      const otherMs = totalMs - parseMs - geometryMs - layoutMs - tilingMs;
      const gl = document.createElement("canvas").getContext("webgl");
      const debug = gl?.getExtension("WEBGL_debug_renderer_info");
      return {
        status: "success",
        native_path:
          "MdsLayoutSettings+layoutGraphWithMds+Sleeve+TileMap.buildUpToLevel",
        execution_evidence: {
          mds_layout_settings_constructed: true,
          layout_graph_with_mds_called: true,
          edge_routing_mode: "Sleeve",
          tile_map_build_completed: true,
        },
        nodes: g.shallowNodeCount,
        edges: g.edgeCount,
        parse_ms: parseMs,
        geometry_ms: geometryMs,
        layout_ms: layoutMs,
        cdt_ms: cdtMs,
        routing_ms: routingMs,
        routing_phases_ms: cdtMs + routingMs,
        routing_phases_detail_ms: phases,
        tiling_ms: tilingMs,
        other_ms: otherMs,
        total_ms: totalMs,
        tile_level_upper_bound: upperBound,
        tile_capacity: capacity,
        native_max_memory_bytes: maxMemoryBytes,
        actual_levels_built: actualLevelsBuilt,
        tile_map_number_of_levels: tileMap.numberOfLevels,
        browser: {
          user_agent: navigator.userAgent,
          headless: false,
          webgl_vendor: debug
            ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL)
            : null,
          webgl_renderer: debug
            ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)
            : null,
        },
      };
    },
    {
      text: graph,
      tileLevelUpperBound,
      tileCapacity,
      nativeMaxMemoryBytes,
    },
  );
  row.browser.chromium_version = browser.version();
  row.browser.page_errors = pageErrors;
  row.browser.lifecycle = lifecycle;
} catch (error) {
  row = {
    status: "failure",
    error: String(error),
    browser_lifecycle: lifecycle,
  };
} finally {
  try {
    await browser?.close();
    if (row?.browser) row.browser.clean_exit = true;
  } catch (error) {
    if (row?.browser) row.browser.clean_exit = false;
    row = row || { status: "failure" };
    row.browser_close_error = String(error);
  }
  await new Promise((resolve) => server.close(resolve));
}
console.log(JSON.stringify(row));
