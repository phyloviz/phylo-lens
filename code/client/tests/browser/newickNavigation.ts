import { createGraphClient } from "../../src/api/graphClient";
import { ViewportSyncController } from "../../src/app/workbench/viewport/viewportSyncController";
import { SigmaRenderer } from "../../src/render/adapters/sigma/sigmaRenderer";
import type { PositionedGraph } from "../../src/contracts/positioned";

const button = document.querySelector<HTMLButtonElement>("#run-newick")!;
const output = document.querySelector<HTMLElement>("#newick-result")!;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
button.addEventListener("click", async () => {
  const file = document.querySelector<HTMLInputElement>("#fixture")!.files?.[0];
  if (!file) {
    output.textContent = "Select a Newick fixture first.";
    return;
  }
  button.disabled = true;
  const renderer = new SigmaRenderer();
  let controller: ViewportSyncController | undefined;
  const records: unknown[] = [];
  let latest: PositionedGraph | undefined;
  let synced = 0;
  let failure: unknown;
  const waitForSync = async (previous: number) => {
    const deadline = performance.now() + 10000;
    while (synced === previous && !failure && performance.now() < deadline) await wait(20);
    if (failure) throw failure;
    if (synced === previous) throw new Error("Viewport did not settle within 10 seconds.");
  };
  try {
    output.textContent = "Preparing fixture…";
    const client = createGraphClient({ baseUrl: location.origin });
    const start = performance.now();
    const prepared = await client.prepareGraph({
      format: "newick",
      dataset_name: file.name,
      content: await file.text(),
    });
    records.push({ operation: "prepare", elapsedMs: performance.now() - start, ...prepared });
    renderer.mount({ container: document.querySelector<HTMLElement>("#graph")! });
    let labels = false;
    controller = new ViewportSyncController({
      datasetId: prepared.dataset_id,
      layoutVersion: prepared.layout_version,
      client,
      renderer,
      nodeCount: prepared.node_count,
      lodTierCount: prepared.lod_tier_count,
      getRenderSettings: () => ({ displayOptions: { edgeDistanceLabels: labels } }),
      onGraphSynced: (graph) => {
        latest = graph;
        synced += 1;
      },
      onError: (error) => {
        failure = error;
      },
    });
    controller.mount();
    await controller.waitForInitialViewport();
    await wait(500);
    for (labels of [false, true]) {
      renderer.updateDisplayOptions({ edgeDistanceLabels: labels });
      controller.updateDisplayOptions({ edgeDistanceLabels: labels });
      let previous = synced;
      controller.refreshNow({ lodLevel: 0 });
      await waitForSync(previous);
      const representative = latest!.nodes.find((node) => node.attributes?.is_cluster_proxy);
      if (!representative) throw new Error("Fixture has no coarse representative to exercise expansion.");
      const beforeExpansion = renderer.getViewportSyncState();
      previous = synced;
      const expandStart = performance.now();
      controller.handleNodeClick({ nodeId: representative.id, attributes: representative.attributes });
      await waitForSync(previous);
      const expansionStable = JSON.stringify(beforeExpansion) === JSON.stringify(renderer.getViewportSyncState());
      records.push({
        operation: "expand",
        labels,
        nodes: latest!.nodes.length,
        elapsedMs: performance.now() - expandStart,
        cameraPreserved: expansionStable,
      });
      if (!expansionStable) throw new Error("Expansion moved the camera.");
      controller.collapseCluster(String(representative.attributes?.cluster_id ?? representative.id));
      const collapseStable = JSON.stringify(beforeExpansion) === JSON.stringify(renderer.getViewportSyncState());
      records.push({ operation: "collapse", labels, cameraPreserved: collapseStable });
      if (!collapseStable) throw new Error("Collapse moved the camera.");
      const focus = { ...latest!, nodes: latest!.nodes.slice(0, 10), edges: [] };
      renderer.fitGraphSnapshot(focus, { resetFirst: false });
      await wait(700);
      const bounds = latest!.viewMeta.globalBounds!;
      renderer.centerOnCoordinates(bounds.maxX + (bounds.maxX - bounds.minX), bounds.minY);
      controller.refreshNow();
      previous = synced;
      await waitForSync(previous);
      const beforeToggle = renderer.getViewportSyncState();
      renderer.updateDisplayOptions({ edgeDistanceLabels: !labels });
      controller.updateDisplayOptions({ edgeDistanceLabels: !labels });
      await wait(100);
      const toggleStable = JSON.stringify(beforeToggle) === JSON.stringify(renderer.getViewportSyncState());
      records.push({
        operation: "pan beyond bounds / zoom / toggle",
        labels,
        cameraPreserved: toggleStable,
        viewport: renderer.getViewportSyncState(),
      });
      if (!toggleStable) throw new Error("Label toggle moved the camera.");
    }
    output.textContent = JSON.stringify(
      { ok: true, fixture: file.name, userAgent: navigator.userAgent, records },
      null,
      2,
    );
  } catch (error) {
    output.textContent = JSON.stringify({ ok: false, error: String(error), records }, null, 2);
  } finally {
    controller?.unmount();
    renderer.unmount();
    button.disabled = false;
  }
});
