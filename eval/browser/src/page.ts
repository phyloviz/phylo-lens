// @ts-expect-error The browser bundle intentionally imports the built public
// package entry; declarations are emitted separately by the package build.
import { createPhyloLensView } from "../../../code/client/dist/index.js";

const root = document.querySelector<HTMLElement>("#graph-root");
if (!root) throw new Error("Missing graph root.");

declare global {
  interface Window {
    phyloLensEvaluation?: {
      run: () => Promise<unknown>;
      createView: (apiUrl: string) => void;
      startFrameSampling: () => void;
      finishFrameSampling: () => number[];
      dispose: () => void;
      rq4?: {
        createView: (apiUrl: string) => void;
        load: (
          content: string,
          name: string,
          maxNodes: number,
        ) => Promise<unknown>;
        beginOperation: () => { t0: number; viewport: unknown };
        observerEvents: () => unknown[];
        observerEventsWithDiagnostics: () => unknown[];
        requestTrace: () => unknown[];
        operationRequestTrace: () => unknown[];
        finishAtFrame: (sequence: number) => Promise<number>;
        armInput: (eventType: "click" | "dblclick") => void;
        inputEvent: () => unknown;
        baselineFrames: (count: number) => Promise<number[]>;
        gpuEvidence: () => unknown;
      };
      rq2Final?: {
        createView: (apiUrl: string) => void;
        load: (
          content: string,
          name: string,
          maxNodes: number,
        ) => Promise<unknown>;
        latestSnapshot: () => unknown;
        gpuEvidence: () => unknown;
        startFrameSampling: () => void;
        finishFrameSampling: () => number[];
        dispose: () => void;
      };
    };
  }
}

let activeView: ReturnType<typeof createPhyloLensView> | undefined;
let frameSampling:
  { samples: number[]; previous?: number; active: boolean } | undefined;
const RQ4_OBSERVER_SYMBOL = Symbol.for(
  "@phyloviz/phylo-lens.internal.snapshot-applied.v1",
);
const rq4ObserverEvents: Array<Record<string, unknown>> = [];
const rq4DiagnosticReaders = new Map<
  number,
  () => Record<string, unknown> | null
>();
const rq4RequestTrace: Array<Record<string, unknown>> = [];
let rq4FetchInstalled = false;
let rq4OperationRequestStart = 0;
let rq4InputEvent: Record<string, unknown> | null = null;
const rq2FinalSnapshots: Array<Record<string, unknown>> = [];

window.phyloLensEvaluation = {
  createView: (apiUrl: string) => {
    if (activeView) throw new Error("Evaluation view is already active.");
    activeView = createPhyloLensView({ container: root, apiUrl });
  },
  run: async () => {
    const view = activeView;
    if (!view) throw new Error("Evaluation view was not created.");
    const t0 = performance.now();
    try {
      await view.load({
        content: "(A:1,B:1)root;",
        name: "rq2-replay",
        lod: { maxNodes: 100000 },
        visualMapping: undefined,
      });
      const t1 = performance.now();
      const t2 = await doubleAnimationFrame();
      const canvas = root.querySelector("canvas");
      const visualOutput =
        canvas instanceof HTMLCanvasElement &&
        canvas.width > 0 &&
        canvas.height > 0;
      return { ok: true, t0, t1, t2, visualOutput };
    } catch (error) {
      view.dispose();
      activeView = undefined;
      return { ok: false, error: String(error) };
    }
  },
  startFrameSampling: () => {
    if (frameSampling) {
      throw new Error("Frame sampling is already active.");
    }
    frameSampling = { samples: [], active: true };
    const tick = (now: number) => {
      const sampler = frameSampling;
      if (!sampler || !sampler.active) return;
      if (sampler.previous !== undefined)
        sampler.samples.push(now - sampler.previous);
      sampler.previous = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  },
  finishFrameSampling: () => {
    if (!frameSampling) throw new Error("Frame sampling was not started.");
    frameSampling.active = false;
    const samples = frameSampling.samples;
    frameSampling = undefined;
    return samples;
  },
  dispose: () => {
    activeView?.dispose();
    activeView = undefined;
  },
};
window.phyloLensEvaluation.rq4 = {
  createView: (apiUrl) => {
    if (activeView) throw new Error("Evaluation view is already active.");
    installRq4FetchTrace();
    rq4ObserverEvents.length = 0;
    rq4DiagnosticReaders.clear();
    rq4RequestTrace.length = 0;
    rq4OperationRequestStart = 0;
    (root as unknown as Record<symbol, unknown>)[RQ4_OBSERVER_SYMBOL] = (
      boundary: Record<string, unknown>,
      readDiagnostics: () => Record<string, unknown> | null,
    ) => {
      const timestamp = performance.now();
      rq4ObserverEvents.push({ timestamp, boundary });
      rq4DiagnosticReaders.set(boundary.sequence as number, readDiagnostics);
    };
    activeView = createPhyloLensView({ container: root, apiUrl });
  },
  load: async (content, name, maxNodes) => {
    if (!activeView) throw new Error("Evaluation view was not created.");
    await activeView.load({ content, name, lod: { maxNodes } });
    const event = rq4ObserverEvents.at(-1);
    return event ? structuredClone(event) : null;
  },
  beginOperation: () => {
    const viewport = latestSnapshotViewport();
    const t0 = performance.now();
    rq4OperationRequestStart = rq4RequestTrace.length;
    if (frameSampling) {
      frameSampling.samples = [];
      frameSampling.previous = t0;
    }
    return { t0, viewport };
  },
  observerEvents: () =>
    rq4ObserverEvents.map((event) => structuredClone(event)),
  observerEventsWithDiagnostics: () =>
    rq4ObserverEvents.map((event) => observerEventWithDiagnostics(event)),
  requestTrace: () => requestTraceWithResourceTimings(rq4RequestTrace),
  operationRequestTrace: () =>
    requestTraceWithResourceTimings(
      rq4RequestTrace.slice(rq4OperationRequestStart),
    ),
  finishAtFrame: async (sequence) => {
    if (
      !rq4ObserverEvents.some(
        (event) =>
          (event.boundary as Record<string, unknown>).sequence === sequence,
      )
    ) {
      throw new Error("snapshot_application_timeout");
    }
    return doubleAnimationFrame();
  },
  armInput: (eventType) => {
    rq4OperationRequestStart = rq4RequestTrace.length;
    rq4InputEvent = null;
    const capture = (event: Event) => {
      if (event.type !== eventType || rq4InputEvent) return;
      const mouse = event as MouseEvent;
      const timestamp = performance.now();
      rq4InputEvent = {
        eventType: event.type,
        timestamp,
        clientX: mouse.clientX,
        clientY: mouse.clientY,
        isTrusted: event.isTrusted,
        viewport: latestSnapshotViewport(),
      };
      if (frameSampling) {
        frameSampling.samples = [];
        frameSampling.previous = timestamp;
      }
      document.removeEventListener(eventType, capture, true);
    };
    document.addEventListener(eventType, capture, true);
  },
  inputEvent: () => (rq4InputEvent ? structuredClone(rq4InputEvent) : null),
  baselineFrames: async (count) => {
    const samples: number[] = [];
    let previous: number | undefined;
    while (samples.length < count) {
      const now = await new Promise<number>((resolve) =>
        requestAnimationFrame(resolve),
      );
      if (previous !== undefined) samples.push(now - previous);
      previous = now;
    }
    return samples;
  },
  gpuEvidence: () => {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (!context)
      return {
        hardware_accelerated: false,
        vendor: null,
        renderer: null,
        backend: null,
      };
    const extension = context.getExtension("WEBGL_debug_renderer_info");
    const vendor = String(
      extension
        ? context.getParameter(extension.UNMASKED_VENDOR_WEBGL)
        : context.getParameter(context.VENDOR),
    );
    const renderer = String(
      extension
        ? context.getParameter(extension.UNMASKED_RENDERER_WEBGL)
        : context.getParameter(context.RENDERER),
    );
    const software = /swiftshader|software|llvmpipe/i.test(
      `${vendor} ${renderer}`,
    );
    return {
      hardware_accelerated: !software,
      vendor,
      renderer,
      backend: /metal/i.test(`${vendor} ${renderer}`) ? "Metal" : "unknown",
    };
  },
};
window.phyloLensEvaluation.rq2Final = {
  createView: (apiUrl) => {
    if (activeView) throw new Error("Evaluation view is already active.");
    rq2FinalSnapshots.length = 0;
    (root as unknown as Record<symbol, unknown>)[RQ4_OBSERVER_SYMBOL] = (
      boundary: Record<string, unknown>,
      readDiagnostics: () => Record<string, unknown> | null,
    ) => {
      const diagnostics = readDiagnostics();
      rq2FinalSnapshots.push({
        ...boundary,
        triangleCount: diagnostics?.visibleAggregateTriangleCount ?? null,
      });
    };
    activeView = createPhyloLensView({ container: root, apiUrl });
  },
  load: async (content, name, maxNodes) => {
    if (!activeView) throw new Error("Evaluation view was not created.");
    const t0 = performance.now();
    await activeView.load({
      content,
      name,
      lod: { maxNodes },
      visualMapping: undefined,
    });
    const t1 = performance.now();
    const t2 = await doubleAnimationFrame();
    return { t0, t1, t2, snapshot: rq2FinalSnapshots.at(-1) ?? null };
  },
  latestSnapshot: () => structuredClone(rq2FinalSnapshots.at(-1) ?? null),
  gpuEvidence: () => {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (!context) return { available: false, vendor: null, renderer: null };
    const extension = context.getExtension("WEBGL_debug_renderer_info");
    const vendor = extension
      ? context.getParameter(extension.UNMASKED_VENDOR_WEBGL)
      : context.getParameter(context.VENDOR);
    const renderer = extension
      ? context.getParameter(extension.UNMASKED_RENDERER_WEBGL)
      : context.getParameter(context.RENDERER);
    return {
      available: true,
      vendor: String(vendor),
      renderer: String(renderer),
    };
  },
  startFrameSampling: () => window.phyloLensEvaluation?.startFrameSampling(),
  finishFrameSampling: () =>
    window.phyloLensEvaluation?.finishFrameSampling() ?? [],
  dispose: () => {
    activeView?.dispose();
    activeView = undefined;
    delete (root as unknown as Record<symbol, unknown>)[RQ4_OBSERVER_SYMBOL];
  },
};
document.documentElement.dataset.rq2Bootstrap = "ready";

function installRq4FetchTrace(): void {
  if (rq4FetchInstalled) return;
  rq4FetchInstalled = true;
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof Request
          ? input.url
          : input.toString();
    const method =
      init?.method ?? (input instanceof Request ? input.method : "GET");
    const record: Record<string, unknown> = {
      url,
      method,
      fetchInvocationTimestamp: performance.now(),
    };
    if (typeof init?.body === "string") {
      record.bodyText = init.body;
    }
    rq4RequestTrace.push(record);
    return originalFetch(input, init);
  };
}

function requestTraceWithResourceTimings(
  records: readonly Record<string, unknown>[],
): Record<string, unknown>[] {
  const resources = performance
    .getEntriesByType("resource")
    .filter(
      (entry): entry is PerformanceResourceTiming =>
        entry.entryType === "resource",
    );
  const used = new Set<PerformanceResourceTiming>();
  return records.map((record) => {
    const invocation = record.fetchInvocationTimestamp;
    const resource = resources.find(
      (entry) =>
        !used.has(entry) &&
        entry.initiatorType === "fetch" &&
        entry.name === record.url &&
        typeof invocation === "number" &&
        entry.startTime >= invocation - 1,
    );
    if (resource) used.add(resource);
    const responseStatus = (
      resource as PerformanceResourceTiming & { responseStatus?: unknown }
    )?.responseStatus;
    const { bodyText, ...safeRecord } = structuredClone(record);
    let body: unknown = null;
    if (typeof bodyText === "string") {
      try {
        body = JSON.parse(bodyText);
      } catch {
        body = null;
      }
    }
    return {
      ...safeRecord,
      body,
      clock: "browser_performance_now",
      dispatchTimestamp: resource?.startTime ?? null,
      responseTimestamp: resource?.responseEnd ?? null,
      status: typeof responseStatus === "number" ? responseStatus : null,
    };
  });
}

function latestSnapshotViewport(): unknown {
  const event = rq4ObserverEvents.at(-1);
  const diagnostics = event
    ? (observerEventWithDiagnostics(event).diagnostics as Record<
        string,
        unknown
      > | null)
    : null;
  return diagnostics?.viewport ?? null;
}

function observerEventWithDiagnostics(
  event: Record<string, unknown>,
): Record<string, unknown> {
  const boundary = event.boundary as Record<string, unknown>;
  const reader = rq4DiagnosticReaders.get(boundary.sequence as number);
  return {
    ...structuredClone(event),
    diagnostics: reader?.() ?? null,
  };
}

function doubleAnimationFrame(): Promise<number> {
  return new Promise((resolve) =>
    requestAnimationFrame(() =>
      requestAnimationFrame(() => resolve(performance.now())),
    ),
  );
}
