import type { PositionedGraph, PositionedNode } from "../../../../contracts/positioned";

export type Point = { x: number; y: number };
type Entry = { server: Point; display: Point; anchor: Point; inherited: Point; cluster?: string };
const zero = (): Point => ({ x: 0, y: 0 });
const offset = (entry: Entry): Point => ({ x: entry.display.x - entry.server.x, y: entry.display.y - entry.server.y });

/** Server coordinates never change. Query padding follows actual display displacement. */
export class DisplayPositions {
  private entries = new Map<string, Entry>();
  private proxies = new Map<string, string>();
  private visible = new Set<string>();
  private margin = 0;
  private lodLevel: number | undefined;
  static readonly HISTORY_LIMIT = 20_000;

  clear(): void {
    this.entries.clear();
    this.proxies.clear();
    this.visible.clear();
    this.margin = 0;
    this.lodLevel = undefined;
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

  reference(id: string): Point | undefined {
    return this.entries.get(id)?.server;
  }

  anchor(id: string): Point | undefined {
    return this.entries.get(id)?.anchor;
  }

  arrange(id: string, point: Point): Point {
    const display = this.set(id, point),
      entry = this.entries.get(id);
    if (entry) entry.anchor = display;
    return display;
  }

  constrain(id: string, point: Point): Point {
    const fallback = this.get(id) ?? this.reference(id) ?? { x: 0, y: 0 };
    return { x: Number.isFinite(point.x) ? point.x : fallback.x, y: Number.isFinite(point.y) ? point.y : fallback.y };
  }

  translate(members: ReadonlyMap<string, Point>, delta: Point): Map<string, Point> {
    return new Map([...members].map(([id, p]) => [id, this.constrain(id, { x: p.x + delta.x, y: p.y + delta.y })]));
  }

  queryPadding(): Point {
    let x = this.margin,
      y = this.margin;

    for (const entry of this.entries.values()) {
      x = Math.max(x, Math.abs(entry.display.x - entry.server.x) + this.margin);
      y = Math.max(y, Math.abs(entry.display.y - entry.server.y) + this.margin);
    }
    return { x, y };
  }

  ingest(graph: PositionedGraph): { nodes: PositionedNode[]; origins: Map<string, Point> } {
    const bounds = graph.viewMeta.globalBounds;

    if (bounds) {
      this.margin = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, 1e-9) * 0.02;
    } else if (!this.entries.size && graph.nodes.length) {
      const bounds = graph.nodes.reduce(
        (b, n) => ({
          minX: Math.min(b.minX, n.x),
          maxX: Math.max(b.maxX, n.x),
          minY: Math.min(b.minY, n.y),
          maxY: Math.max(b.maxY, n.y),
        }),
        { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity },
      );
      this.margin = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, 1e-9) * 0.02;
    }

    const tierChanged = this.lodLevel !== undefined && this.lodLevel !== graph.viewMeta.lodLevel;
    this.lodLevel = graph.viewMeta.lodLevel;
    const origins = new Map<string, Point>();
    const previous = this.visible;
    const previousClusters = new Map<string, Entry[]>();

    for (const id of previous) {
      const entry = this.entries.get(id);

      if (entry?.cluster) {
        const members = previousClusters.get(entry.cluster) ?? [];
        members.push(entry);
        previousClusters.set(entry.cluster, members);
      }
    }

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
        const children = previousClusters.get(cluster) ?? [];

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

      if (tierChanged) {
        display = { x: node.x, y: node.y };
        inherited = zero();
      }

      const anchor = tierChanged ? display : (existing?.anchor ?? display);
      this.entries.delete(node.id);
      this.entries.set(node.id, { server: { x: node.x, y: node.y }, display, anchor, inherited, cluster });
      display = this.set(node.id, display);

      return { ...node, ...display };
    });

    for (const node of graph.nodes)
      if (node.attributes?.is_cluster_proxy === true && typeof node.attributes.cluster_id === "string")
        this.proxies.set(node.attributes.cluster_id, node.id);

    this.visible = new Set(graph.nodes.map((n) => n.id));
    // Forget old tiers and bound off-screen history; visible nodes are never evicted.
    for (const id of this.entries.keys()) {
      if (!this.visible.has(id) && (tierChanged || this.entries.size > DisplayPositions.HISTORY_LIMIT))
        this.entries.delete(id);
    }

    for (const [cluster, id] of this.proxies) if (!this.entries.has(id)) this.proxies.delete(cluster);

    return { nodes, origins };
  }
}
