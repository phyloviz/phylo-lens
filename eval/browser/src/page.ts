// @ts-expect-error The browser bundle intentionally imports the built public
// package entry; declarations are emitted separately by the package build.
import { createPhyloLensView } from "../../../code/client/dist/index.js";
import { armCaptureInput } from "./rq4-input-capture.mjs";

const root = document.querySelector<HTMLElement>("#graph-root");
if (!root) throw new Error("Missing graph root.");

declare global {
  interface Window {
    phyloLensEvaluation?: {
      run: () => Promise<unknown>;
      createView: (apiUrl: string) => void;
      startFrameSampling: () => void;
      finishFrameSampling: (end?: number) => number[];
      dispose: () => void;
      rq4?: {
        createView: (apiUrl: string) => void;
        load: (
          content: string,
          name: string,
          maxNodes: number,
        ) => Promise<unknown>;
        configureLocalCapture: (query?: Record<string, unknown>) => void;
        prepareLocalExpansion: (preserveLevel?: boolean) => Promise<void>;
        beginOperation: () => { t0: number; viewport: unknown };
        observerEvents: () => unknown[];
        observerEventsWithDiagnostics: () => unknown[];
        requestTrace: () => unknown[];
        timerTrace: () => unknown[];
        operationRequestTrace: () => unknown[];
        finishAtFrame: (sequence: number) => Promise<number>;
        expansionControl: (
          clusterId: string,
          operation: "cluster_expand" | "cluster_collapse",
        ) => { clientX: number; clientY: number };
        armInput: (specification: {
          eventType: "click" | "dblclick";
          nativeEventType: "click" | "dblclick";
          clickCount: number | null;
          clientX: number;
          clientY: number;
          targetClusterId: string | null;
        }) => void;
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
        pinReplay: () => Promise<unknown>;
        gpuEvidence: () => unknown;
        startFrameSampling: () => void;
        finishFrameSampling: () => number[];
        dispose: () => void;
      };
    };
  }
}

let activeView: ReturnType<typeof createPhyloLensView> | undefined;
let localInitialQuery: Record<string, unknown> | undefined;
const localTimers: Array<Record<string, unknown>> = [];
let localTimersInstalled = false;
let frameSampling:
  | {
      samples: number[];
      timestamps: number[];
      previous?: number;
      active: boolean;
    }
  | undefined;
const localDisplayBoundaries = new Map<number, Promise<number>>();
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
let rq4LocalCapture = false;
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
    frameSampling = { samples: [], timestamps: [], active: true };
    const tick = (now: number) => {
      const sampler = frameSampling;
      if (!sampler || !sampler.active) return;
      // requestAnimationFrame's frame timestamp can precede a performance.now()
      // captured during the current frame. That boundary is not a frame interval.
      if (sampler.previous !== undefined && now >= sampler.previous) {
        sampler.samples.push(now - sampler.previous);
        sampler.timestamps.push(now);
      }
      sampler.previous = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  },
  finishFrameSampling: (end) => {
    if (!frameSampling) throw new Error("Frame sampling was not started.");
    frameSampling.active = false;
    const samples = frameSampling.samples.filter(
      (_, index) =>
        end === undefined || frameSampling!.timestamps[index] <= end,
    );
    frameSampling = undefined;
    return samples;
  },
  dispose: () => {
    activeView?.dispose();
    activeView = undefined;
  },
};
window.phyloLensEvaluation.rq4 = {
  configureLocalCapture: (query) => {
    rq4LocalCapture = true;
    localInitialQuery = query;
    if (!localTimersInstalled) {
      localTimersInstalled = true;
      const schedule = window.setTimeout.bind(window);
      window.setTimeout = ((
        handler: TimerHandler,
        delay?: number,
        ...args: unknown[]
      ) => {
        if (typeof handler !== "function" || (delay !== 60 && delay !== 120))
          return schedule(handler, delay, ...args);
        const record: Record<string, unknown> = {
          delay_ms: delay,
          scheduled: performance.now(),
          stack: new Error().stack,
        };
        localTimers.push(record);
        const id = schedule(() => {
          record.fired = performance.now();
          handler(...args);
        }, delay);
        record.timer_id = id;
        return id;
      }) as typeof window.setTimeout;
    }
  },
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
      if (rq4LocalCapture)
        localDisplayBoundaries.set(
          boundary.sequence as number,
          doubleAnimationFrame(),
        );
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
  prepareLocalExpansion: async (preserveLevel) => {
    if (!activeView) throw new Error("Evaluation view was not created.");
    if (!preserveLevel) await activeView.collapseAll();
    activeView.setKeepExpanded(true);
  },
  beginOperation: () => {
    const viewport = latestSnapshotViewport();
    const t0 = performance.now();
    rq4OperationRequestStart = rq4RequestTrace.length;
    if (frameSampling) {
      frameSampling.samples = [];
      frameSampling.timestamps = [];
      frameSampling.previous = t0;
    }
    return { t0, viewport };
  },
  observerEvents: () =>
    rq4ObserverEvents.map((event) => structuredClone(event)),
  observerEventsWithDiagnostics: () =>
    rq4ObserverEvents.map((event) => observerEventWithDiagnostics(event)),
  requestTrace: () => requestTraceWithResourceTimings(rq4RequestTrace),
  timerTrace: () =>
    localTimers.filter(
      (record) =>
        typeof rq4InputEvent?.timestamp === "number" &&
        (record.scheduled as number) >= rq4InputEvent.timestamp,
    ),
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
    return rq4LocalCapture
      ? localDisplayBoundaries.get(sequence)!
      : doubleAnimationFrame();
  },
  expansionControl: (clusterId, operation) => {
    root.querySelector("#expansion-action")?.remove();
    const button = document.createElement("button");
    button.id = "expansion-action";
    button.textContent =
      operation === "cluster_expand" ? "Expand group" : "Collapse group";
    Object.assign(button.style, {
      position: "absolute",
      left: "8px",
      top: "8px",
      zIndex: "10",
    });
    button.addEventListener("click", () => {
      if (operation === "cluster_expand")
        void activeView?.expandCluster(clusterId);
      else activeView?.collapseCluster(clusterId);
    });
    root.appendChild(button);
    const rect = button.getBoundingClientRect();
    return {
      clientX: rect.x + rect.width / 2,
      clientY: rect.y + rect.height / 2,
    };
  },
  armInput: (specification) => {
    rq4OperationRequestStart = rq4RequestTrace.length;
    rq4InputEvent = null;
    armCaptureInput(document, root, specification, (captured) => {
      rq4OperationRequestStart = rq4RequestTrace.length;
      rq4InputEvent = {
        ...captured,
        viewport: latestSnapshotViewport(),
      };
      if (frameSampling) {
        frameSampling.samples = [];
        frameSampling.timestamps = [];
        frameSampling.previous = captured.timestamp;
      }
    });
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
  pinReplay: async () => {
    if (!activeView) throw new Error("Missing replay view");
    activeView?.setKeepExpanded(true);
    await new Promise((resolve) => setTimeout(resolve, 600));
    const result = await activeView.expandAll();
    if (
      result.status !== "complete" ||
      !result.allExpanded ||
      !result.keepExpanded
    )
      throw new Error("Replay setup did not complete the pinned expansion");
    return result;
  },
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
    if (localInitialQuery && new URL(url).pathname === "/api/graph/viewport") {
      init = { ...init, body: JSON.stringify(localInitialQuery) };
      localInitialQuery = undefined;
    }
    const record: Record<string, unknown> = {
      url,
      method,
      fetchInvocationTimestamp: performance.now(),
    };
    if (typeof init?.body === "string") {
      record.bodyText = init.body;
    }
    rq4RequestTrace.push(record);
    if (!rq4LocalCapture) return originalFetch(input, init);
    return originalFetch(input, init).then((response) => {
      if (rq4LocalCapture && new URL(url).pathname === "/api/graph/viewport") {
        // Observe the one JSON parse the product already performs. Do not clone
        // the response or rely on Chromium retaining a large inspector body.
        const parseJson = response.json.bind(response);
        response.json = async () => {
          const body: Record<string, unknown> = await parseJson();
          record.responseMetadata = {
            status: response.status,
            node_count: Array.isArray(body.nodes) ? body.nodes.length : null,
            edge_count: Array.isArray(body.edges) ? body.edges.length : null,
            total_node_count: body.total_node_count,
            truncated: body.truncated,
            lod_level: body.lod_level,
            layout_version: body.layout_version,
            payload_bytes: Number(response.headers.get("content-length")),
            server_timing: response.headers.get("server-timing"),
            aggregate_count: Array.isArray(body.nodes)
              ? body.nodes.filter((node) => node.member_count > 1).length
              : null,
          };
          record.jsonParsedTimestamp = performance.now();
          return body;
        };
      }
      return response;
    });
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
      encodedBodySize: resource?.encodedBodySize ?? null,
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
