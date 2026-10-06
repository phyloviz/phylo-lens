import { createHttpClient } from '../../src/services/httpClient';
import { readGraphViewport } from '../../src/services/graph/graphViewportService';
import { toDatasetId, toLayoutVersion } from '../../src/contracts/graph/graphIdentifiers';
import { GraphViewportCoordinator } from '../../src/app/workbench/viewport/viewportCoordinator';
import createSigmaRenderer from '../../src/render/adapters/sigma/sigmaRenderer';
import type { PositionedGraph } from '../../src/contracts/positioned';
import Sigma from 'sigma';

// Observe Sigma's public API for browser checks without exposing renderer internals.
const observed: { sigma?: Sigma } = {};
const originalGetCamera = Sigma.prototype.getCamera;
Sigma.prototype.getCamera = function () {
  observed.sigma = this;
  return originalGetCamera.call(this);
};
window.addEventListener('pagehide', () => {
  Sigma.prototype.getCamera = originalGetCamera;
});
// Deterministic server-position fixture. Use the real Sigma renderer and real worker.
const crowded = new URLSearchParams(location.search).has('crowded');
const nodes = Array.from({ length: crowded ? 53 : 127 }, (_, i) => {
  const level = Math.floor(Math.log2(i + 1));
  if (crowded) return { id: String(i), x: 6 + i * 0.000001, y: 1, size: 5 };
  return { id: String(i), x: (12 * (i - (2 ** level - 1) + 0.5)) / 2 ** level, y: level * 0.3, size: 5 };
});
const snapshot: PositionedGraph = {
  nodes,
  edges: nodes.slice(1).map(n => ({ id: `e${n.id}`, source: String(Math.floor((+n.id - 1) / 2)), target: n.id })),
  viewMeta: { layout: 'server', lodLevel: 0, globalBounds: { minX: 0, maxX: 12, minY: -2, maxY: 4 } },
};
const renderer = createSigmaRenderer();
renderer.mount({ container: document.querySelector<HTMLElement>('#graph')! });
renderer.render(snapshot);
Object.assign(window, {
  motionFixture: {
    renderer,
    snapshot,
    get sigma() {
      if (!observed.sigma) throw new Error('Browser fixture has no Sigma instance.');
      return observed.sigma;
    },
    get graph() {
      return this.sigma.getGraph();
    },
  },
});

// Optional integration mode uses real product viewport responses.
Object.assign(window, {
  startLiveViewport: async (
    url: string,
    datasetId: string,
    layoutVersion: string,
    lodTierCount: number,
    nodeCount: number
  ) => {
    const requests: unknown[] = [];
    const controller = new GraphViewportCoordinator({
      datasetId: toDatasetId(datasetId),
      layoutVersion: toLayoutVersion(layoutVersion),
      lodTierCount,
      nodeCount,
      renderer,
      client: {
        readViewport: async query => {
          const http = createHttpClient({ baseUrl: '', fetchImpl: (_path, init) => fetch(url, init) });
          const result = await readGraphViewport(http, query);
          requests.push({ query, level: result.lodLevel, count: result.nodes.length });
          return result;
        },
      },
    });
    Object.assign(window, { liveViewport: { controller, requests } });
    controller.mount();
    await controller.waitForInitialViewport();
  },
});
