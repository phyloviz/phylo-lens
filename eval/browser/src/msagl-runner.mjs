/* Current-source MSAGLJS native MDS preparation runner; stdout is one JSON row. */
import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

const [corePath, graphPath, timeoutText] = process.argv.slice(2);
const timeoutMs = Number(timeoutText) * 1000;
const graph = await readFile(graphPath, "utf8");
const server = createServer((req, res) => {
  if (req.url === "/core.js") return readFile(corePath).then((b) => res.end(b));
  res.end('<script src="/core.js"></script>');
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
let browser;
try {
  browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}`);
  page.setDefaultTimeout(timeoutMs);
  const row = await page.evaluate((text) => {
    const M = globalThis.msagl;
    const t = performance.now();
    const nodes = new Map();
    const g = new M.Graph();
    const node = (id) =>
      nodes.get(id) ||
      (nodes.set(id, new M.Node(id)), g.addNode(nodes.get(id)), nodes.get(id));
    const p = performance.now();
    for (const l of text.trim().split("\n")) {
      const [a, b] = l.split("\t");
      new M.Edge(node(a), node(b));
    }
    const parseMs = performance.now() - p;
    const gg = new M.GeomGraph(g);
    for (const n of g.shallowNodes) {
      const x = new M.GeomNode(n);
      x.boundaryCurve = M.CurveFactory.mkRectangleWithRoundedCorners(
        30,
        20,
        3,
        3,
        new M.Point(0, 0),
      );
    }
    for (const e of g.deepEdges) new M.GeomEdge(e);
    const s = new M.MdsLayoutSettings();
    s.edgeRoutingSettings.EdgeRoutingMode = M.EdgeRoutingMode.Sleeve;
    gg.layoutSettings = s;
    const phases = {},
      realTime = console.time,
      realEnd = console.timeEnd,
      starts = new Map();
    console.time = (x) => starts.set(x, performance.now());
    console.timeEnd = (x) => {
      if (starts.has(x))
        phases[x] = (phases[x] || 0) + performance.now() - starts.get(x);
    };
    const l = performance.now();
    M.layoutGraphWithMds(gg, null);
    const layoutMs = performance.now() - l;
    console.time = realTime;
    console.timeEnd = realEnd;
    const b = gg.boundingBox,
      z = 2 ** Math.ceil(Math.log2(Math.max(b.width, b.height))),
      r = new M.Rectangle({
        left: b.left - (z - b.width) / 2,
        bottom: b.bottom - (z - b.height) / 2,
        right: b.right + (z - b.width) / 2,
        top: b.top + (z - b.height) / 2,
      });
    const tm = new M.TileMap(gg, r, 500),
      q = performance.now(),
      tileLevels = tm.buildUpToLevel(30),
      tilingMs = performance.now() - q;
    return {
      status: "success",
      native_path:
        "MdsLayoutSettings+layoutGraphWithMds+Sleeve+TileMap.buildUpToLevel",
      nodes: g.shallowNodeCount,
      edges: g.edgeCount,
      parse_ms: parseMs,
      layout_ms: layoutMs,
      routing_cdt_ms: phases["SleeveRouter CDT"] || 0,
      routing_ms: phases["SleeveRouter routing"] || 0,
      tiling_ms: tilingMs,
      total_ms: performance.now() - t,
      tile_levels: tileLevels,
      browser: { version: navigator.userAgent, headless: false },
    };
  }, graph);
  console.log(JSON.stringify(row));
} catch (error) {
  console.log(JSON.stringify({ status: "failure", error: String(error) }));
} finally {
  await browser?.close();
  server.close();
}
