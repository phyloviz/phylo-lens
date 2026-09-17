import { createGraphClient } from "../../src/api/graphClient";
import { createGraphWorkbench } from "../../src/app/workbench/graphWorkbench";
import { SigmaRenderer } from "../../src/render/adapters/sigma/sigmaRenderer";
import type { PositionedGraph } from "../../src/contracts/positioned";

const output = document.querySelector<HTMLElement>("#result")!;
let disposePrevious: (() => void) | undefined;
const button = document.querySelector<HTMLButtonElement>("#run")!;
button.addEventListener("click", async () => {
  const file = document.querySelector<HTMLInputElement>("#fixture")!.files?.[0];
  if (!file) {
    output.textContent = "Select a Newick fixture.";
    return;
  }
  button.disabled = true;
  disposePrevious?.();
  const client = createGraphClient({ baseUrl: location.origin });
  const renderer = new SigmaRenderer();
  let release: (() => void) | undefined;
  let delayed = false;
  const workbench = createGraphWorkbench({
    graphClient: {
      ...client,
      readViewport: async (query) => {
        const response = await client.readViewport(query);
        if (delayed && query.focus_node_id) {
          delayed = false;
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
        return response;
      },
    },
    rendererFactory: { createRenderer: () => renderer },
    rendererKind: "sigma",
    renderContext: { container: document.querySelector<HTMLElement>("#graph")! },
  });
  disposePrevious = () => workbench.dispose();
  let graph: PositionedGraph | undefined;
  workbench.setGraphRenderedHandler((value) => {
    graph = value;
  });
  const records: unknown[] = [];
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  try {
    output.textContent = "Running…";
    await workbench.renderNewick(await file.text(), file.name, { lod: { maxNodes: 2 } });
    await wait(500);
    const find = async (id: string) => {
      const result = await workbench.searchNodes({ query: id });
      const match = result.matches.find((item) => item.node_id === id);
      if (!match) throw new Error(`Missing search result ${id}`);
      return match;
    };
    const first = await find("n0");
    const second = await find("n6000");
    const focus = (match: typeof first) =>
      workbench.focusNode(match.node_id, { x: match.x ?? null, y: match.y ?? null, clusterId: match.cluster_id });
    await focus(first);
    if (!graph?.nodes.some((node) => node.id === first.node_id) || graph.nodes.length > 2)
      throw new Error("Target was dropped at budget.");
    records.push({
      operation: "focus collapsed target at full budget",
      target: first.node_id,
      nodes: graph.nodes.map((node) => node.id),
    });
    const centered = renderer.getViewportSyncState();
    renderer.centerOnCoordinates(100000, 100000);
    await focus(first);
    if (JSON.stringify(centered) !== JSON.stringify(renderer.getViewportSyncState()))
      throw new Error(
        `Repeated focus did not recenter: ${JSON.stringify({ centered, after: renderer.getViewportSyncState() })}`,
      );
    records.push({ operation: "repeat focus after panning", ok: true });
    delayed = true;
    const pending = focus(second);
    const deadline = performance.now() + 10000;
    while (!release && performance.now() < deadline) await wait(20);
    if (!release) throw new Error("Delayed request did not arrive.");
    await focus(first);
    const newest = renderer.getViewportSyncState();
    release();
    await pending;
    if (JSON.stringify(newest) !== JSON.stringify(renderer.getViewportSyncState()))
      throw new Error("Stale response moved camera.");
    if (!graph.nodes.some((node) => node.id === first.node_id)) throw new Error("Stale response replaced target.");
    records.push({ operation: "stale offscreen focus after newer visible focus", ok: true });
    await focus(second);
    if (!graph.nodes.some((node) => node.id === second.node_id)) throw new Error("Offscreen target missing.");
    records.push({
      operation: "focus offscreen target",
      target: second.node_id,
      nodes: graph.nodes.map((node) => node.id),
    });
    output.textContent = JSON.stringify({ ok: true, fixture: file.name, records }, null, 2);
  } catch (error) {
    output.textContent = JSON.stringify({ ok: false, error: String(error), records }, null, 2);
  } finally {
    release?.();
    button.disabled = false;
  }
});
