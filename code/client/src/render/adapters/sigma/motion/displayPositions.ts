import type { PositionedGraph, PositionedNode } from "../../../../contracts/positioned";

export type Point = { x: number; y: number };
type Entry = { server: Point; display: Point; inherited: Point; cluster?: string };
const zero = (): Point => ({ x: 0, y: 0 });
const offset = (entry: Entry): Point => ({ x: entry.display.x - entry.server.x, y: entry.display.y - entry.server.y });

/** Server coordinates never change. Display positions are bounded to make padded server queries sound. */
export class DisplayPositions {
  private entries = new Map<string, Entry>();
  private proxies = new Map<string, string>();
  private visible = new Set<string>();
  limit = 1;

  clear(): void {
    this.entries.clear();
    this.proxies.clear();
    this.visible.clear();
  }
  get(id: string): Point | undefined {
    return this.entries.get(id)?.display;
  }
  set(id: string, point: Point): Point {
    const entry = this.entries.get(id);
    const bounded = this.constrain(id, point);
    if (entry) entry.display = bounded;
    return bounded;
  }
  constrain(id: string, point: Point): Point {
    const home = this.entries.get(id)?.server;
    if (!home) return point;
    return {
      x: Math.max(home.x - this.limit, Math.min(home.x + this.limit, Number.isFinite(point.x) ? point.x : home.x)),
      y: Math.max(home.y - this.limit, Math.min(home.y + this.limit, Number.isFinite(point.y) ? point.y : home.y)),
    };
  }
  /** Clamp a common translation, never each member independently (which would distort a group). */
  translate(members: ReadonlyMap<string, Point>, delta: Point): Map<string, Point> {
    let xmin = -Infinity,
      xmax = Infinity,
      ymin = -Infinity,
      ymax = Infinity;
    for (const [id, point] of members) {
      const home = this.entries.get(id)?.server;
      if (!home) continue;
      xmin = Math.max(xmin, home.x - this.limit - point.x);
      xmax = Math.min(xmax, home.x + this.limit - point.x);
      ymin = Math.max(ymin, home.y - this.limit - point.y);
      ymax = Math.min(ymax, home.y + this.limit - point.y);
    }
    const dx = Math.max(xmin, Math.min(xmax, delta.x)),
      dy = Math.max(ymin, Math.min(ymax, delta.y));
    return new Map([...members].map(([id, p]) => [id, { x: p.x + dx, y: p.y + dy }]));
  }

  ingest(graph: PositionedGraph): { nodes: PositionedNode[]; origins: Map<string, Point> } {
    const bounds = graph.viewMeta.globalBounds;
    if (bounds) this.limit = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, 1) * 0.1;
    else if (!this.entries.size && graph.nodes.length) {
      const bounds = graph.nodes.reduce(
        (b, n) => ({
          minX: Math.min(b.minX, n.x),
          maxX: Math.max(b.maxX, n.x),
          minY: Math.min(b.minY, n.y),
          maxY: Math.max(b.maxY, n.y),
        }),
        { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity },
      );
      this.limit = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, 1) * 0.1;
    }
    const origins = new Map<string, Point>();
    const previous = this.visible;
    const nodes = graph.nodes.map((node) => {
      const cluster = typeof node.attributes?.cluster_id === "string" ? node.attributes.cluster_id : undefined;
      const proxyId = cluster ? this.proxies.get(cluster) : undefined;
      const parent = proxyId ? this.entries.get(proxyId) : undefined;
      const existing = this.entries.get(node.id);
      let inherited = existing?.inherited ?? zero();
      let display = existing?.display ?? node;
      if (!previous.has(node.id) && parent && proxyId !== node.id && previous.has(proxyId!)) {
        const shift = offset(parent);
        const residual = existing ? offset(existing) : zero();
        display = { x: node.x + residual.x - inherited.x + shift.x, y: node.y + residual.y - inherited.y + shift.y };
        inherited = shift;
        origins.set(node.id, parent.display);
      } else if (!previous.has(node.id) && node.attributes?.is_cluster_proxy === true && cluster) {
        const children = [...previous].map((id) => this.entries.get(id)!).filter((e) => e?.cluster === cluster);
        if (children.length) {
          const shifts = children.map(offset);
          display = {
            x: node.x + shifts.reduce((sum, p) => sum + p.x, 0) / shifts.length,
            y: node.y + shifts.reduce((sum, p) => sum + p.y, 0) / shifts.length,
          };
          const baseline = { x: display.x - node.x, y: display.y - node.y };
          children.forEach((child) => {
            child.inherited = baseline;
          });
          origins.set(node.id, display);
        }
      }
      this.entries.set(node.id, { server: { x: node.x, y: node.y }, display, inherited, cluster });
      display = this.set(node.id, display);
      return { ...node, ...display };
    });
    for (const node of graph.nodes)
      if (node.attributes?.is_cluster_proxy === true && typeof node.attributes.cluster_id === "string")
        this.proxies.set(node.attributes.cluster_id, node.id);
    this.visible = new Set(graph.nodes.map((n) => n.id));
    return { nodes, origins };
  }
}
