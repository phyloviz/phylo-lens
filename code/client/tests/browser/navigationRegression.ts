import "./newickNavigation";
import { SigmaRenderer } from "../../src/render/adapters/sigma/sigmaRenderer";
import type { PositionedGraph } from "../../src/contracts/positioned";

const container = document.querySelector<HTMLElement>("#graph")!;
const result = document.querySelector<HTMLElement>("#result")!;
const button = document.querySelector<HTMLButtonElement>("#run")!;
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
const settle = async () => {
  await frame();
  await frame();
};
const graph: PositionedGraph = {
  nodes: Array.from({ length: 10000 }, (_, i) => ({
    id: String(i),
    x: (i % 100) * 10,
    y: Math.floor(i / 100) * 10,
  })),
  edges: Array.from({ length: 9999 }, (_, i) => ({
    id: `e${i}`,
    source: String(Math.floor(i / 2)),
    target: String(i + 1),
    attributes: { distance: (i % 20) + 1 },
  })),
  viewMeta: { layout: "server", lodLevel: 1, globalBounds: { minX: 0, maxX: 990, minY: 0, maxY: 990 } },
};
const slice: PositionedGraph = { ...graph, nodes: graph.nodes.slice(0, 1000), edges: graph.edges.slice(0, 999) };

button.addEventListener("click", async () => {
  button.disabled = true;
  const renderer = new SigmaRenderer();
  const measurements: unknown[] = [];
  const failures: string[] = [];
  try {
    renderer.mount({ container });
    for (const [width, height] of [
      [1000, 400],
      [400, 1000],
    ]) {
      container.style.width = `${width}px`;
      container.style.height = `${height}px`;
      window.dispatchEvent(new Event("resize"));
      await settle();
      renderer.applyGraphSnapshot(graph);
      await settle();
      renderer.fitGraphSnapshot({ ...graph, nodes: graph.nodes.slice(0, 20), edges: [] }, { resetFirst: false });
      await new Promise((resolve) => setTimeout(resolve, 400));
      for (const [x, y] of [
        [495, 495],
        [1500, -500],
      ]) {
        renderer.centerOnCoordinates(x, y);
        await settle();
        const before = renderer.getViewportSyncState()!;
        for (const labels of [false, true, false]) {
          const t0 = performance.now();
          renderer.applyGraphSnapshot(slice);
          renderer.updateDisplayOptions({ edgeDistanceLabels: labels });
          await settle();
          const after = renderer.getViewportSyncState()!;
          const drift = Math.max(
            ...Object.keys(before!.bounds).map((key) =>
              Math.abs(
                after!.bounds[key as keyof typeof after.bounds] - before!.bounds[key as keyof typeof before.bounds],
              ),
            ),
          );
          const bounds = after!.bounds;
          const centerError = Math.max(
            Math.abs((bounds.xmin + bounds.xmax) / 2 - x),
            Math.abs((bounds.ymin + bounds.ymax) / 2 - y),
          );
          const aspectError = Math.abs((bounds.xmax - bounds.xmin) / (bounds.ymax - bounds.ymin) - width / height);
          const pass =
            drift < 0.001 && centerError < 0.01 && aspectError < 0.001 && after!.cameraRatio === before!.cameraRatio;
          measurements.push({
            width,
            height,
            x,
            y,
            labels,
            drift,
            centerError,
            aspectError,
            cameraRatio: after!.cameraRatio,
            pass,
            elapsedMs: performance.now() - t0,
          });
          if (!pass) failures.push(`${width}x${height}, center ${x},${y}, labels ${labels}`);
          renderer.applyGraphSnapshot(graph);
          await settle();
        }
      }
    }
    renderer.fitGraphSnapshot(graph);
    await new Promise((resolve) => setTimeout(resolve, 100));
    container.dispatchEvent(new Event("pointerdown"));
    await settle();
    const interrupted = renderer.getViewportSyncState();
    await new Promise((resolve) => setTimeout(resolve, 600));
    const cancellationPass = JSON.stringify(interrupted) === JSON.stringify(renderer.getViewportSyncState());
    if (!cancellationPass) failures.push("Fit moved the camera after pointer input");
    measurements.push({ cancellationPass });
    result.textContent = JSON.stringify(
      {
        ok: failures.length === 0,
        userAgent: navigator.userAgent,
        nodeCount: graph.nodes.length,
        sliceNodeCount: slice.nodes.length,
        failures,
        measurements,
      },
      null,
      2,
    );
  } catch (error) {
    result.textContent = String(error);
  } finally {
    renderer.unmount();
    button.disabled = false;
  }
});
