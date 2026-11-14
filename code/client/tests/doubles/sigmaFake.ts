import type Graph from 'graphology';
import type { Point } from '../../src/contracts/Point';

type SigmaEvent = { node?: string; event?: { node?: string; x?: number; y?: number } };
type Handler<T> = (payload: T) => void;

/** Instance-owned listeners: removing one listener cannot reset another subsystem. */
class Events<T> {
  readonly handlers = new Map<string, Set<Handler<T>>>();
  on(event: string, handler: Handler<T>) {
    let listeners = this.handlers.get(event);
    if (!listeners) this.handlers.set(event, (listeners = new Set()));
    listeners.add(handler);
    return this;
  }
  off(event: string, handler: Handler<T>) {
    this.handlers.get(event)?.delete(handler);
    return this;
  }
  emit(event: string, payload: T) {
    this.handlers.get(event)?.forEach(handler => handler(payload));
  }
  handler(event: string): Handler<T> | null {
    return this.handlers.get(event)?.values().next().value ?? null;
  }
}

export function createSigmaDoubles() {
  const instances: FakeSigma[] = [];
  const defaults = {
    graphToViewport: (point: Point) => point,
    viewportToFramedGraph: (point: Point) => point,
  };
  class FakeSigma extends Events<SigmaEvent> {
    readonly graph: Graph;
    readonly settings: Record<string, unknown>;
    readonly mouse = new Events<Point>();
    readonly camera = Object.assign(new Events<void>(), {
      state: { ratio: 1 } as { x?: number; y?: number; ratio?: number },
      setState: (state: { x?: number; y?: number; ratio?: number }) => {
        this.camera.state = { ...this.camera.state, ...state };
      },
      getState: () => this.camera.state,
    });
    dimensions = { width: 300, height: 200 };
    scaleSize: ((size: number) => number) | undefined;
    customBBox: { x: [number, number]; y: [number, number] } | null = null;
    customBBoxCalls = 0;
    scheduledRenders = 0;
    disposed = false;
    graphToViewport = defaults.graphToViewport;
    viewportToFramedGraph = defaults.viewportToFramedGraph;
    constructor(graph: Graph, _container?: unknown, settings: Record<string, unknown> = {}) {
      super();
      this.graph = graph;
      this.settings = { ...settings };
      instances.push(this);
    }
    getMouseCaptor() {
      return this.mouse;
    }
    getCamera() {
      return this.camera;
    }
    getGraph() {
      return this.graph;
    }
    refresh() {}
    getSetting(key: string) {
      return this.settings[key];
    }
    setSetting(key: string, value: unknown) {
      this.settings[key] = value;
      return this;
    }
    scheduleRender() {
      this.scheduledRenders++;
      return this;
    }
    viewportToGraph(point: Point) {
      return point;
    }
    getDimensions() {
      return this.dimensions;
    }
    setCustomBBox(bounds: { x: [number, number]; y: [number, number] } | null) {
      this.customBBox = bounds;
      this.customBBoxCalls++;
      return this;
    }
    kill() {
      this.disposed = true;
    }
  }
  return { instances, defaults, Sigma: FakeSigma };
}
