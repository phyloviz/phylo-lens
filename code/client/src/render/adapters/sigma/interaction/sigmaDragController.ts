import type Graph from "graphology";
import type Sigma from "sigma";
import type { DragSelection } from "../../../renderer.types";

type Point = { x: number; y: number };
type Pointer = Point & { preventSigmaDefault?: () => void; original?: MouseEvent | TouchEvent };
type NodeEvent = { node: string; event: Pointer; preventSigmaDefault?: () => void };
type Member = Point & { fixed: boolean };

interface Options {
  getGraph: () => Graph | null;
  getSigma: () => Sigma | null;
  getSelection: () => DragSelection;
  isRegionSelectionEnabled: () => boolean;
  onStart: (ids: readonly string[]) => void;
  onEnd: () => void;
  onUnavailable: (message: string) => void;
  translate: (members: ReadonlyMap<string, Point>, delta: Point) => ReadonlyMap<string, Point>;
  onMoved: (positions: ReadonlyMap<string, Point>) => void;
  suppressViewChangesFor: (durationMs: number) => void;
  suppressNodeClicksFor: (durationMs: number) => void;
}

export default function (options: Options) {
  let members = new Map<string, Member>();
  let origin: Point | null = null;
  let panning = true;
  let moved = false;

  function reset(): void {
    const graph = options.getGraph();
    const sigma = options.getSigma();
    if (origin) sigma?.setSetting("enableCameraPanning", panning);
    members.forEach((member, id) => {
      if (graph?.hasNode(id)) graph.setNodeAttribute(id, "fixed", member.fixed);
    });
    const active = origin !== null;
    members.clear();
    origin = null;
    moved = false;
    if (active) options.onEnd();
  }

  function start(payload: NodeEvent): void {
    const graph = options.getGraph();
    const sigma = options.getSigma();
    if (!graph || !sigma || options.isRegionSelectionEnabled() || payload.event.original?.shiftKey) return;
    reset();
    const selection = resolveDragMembers(graph, payload.node, options.getSelection());
    if (selection.error) {
      options.onUnavailable(selection.error);
      payload.event.preventSigmaDefault?.();
      return;
    }
    const ids = selection.nodeIds;
    members = new Map(
      ids.map((id) => [
        id,
        {
          x: graph.getNodeAttribute(id, "x"),
          y: graph.getNodeAttribute(id, "y"),
          fixed: graph.getNodeAttribute(id, "fixed") === true,
        },
      ]),
    );
    origin = sigma.viewportToGraph(payload.event);
    panning = sigma.getSetting("enableCameraPanning");
    sigma.setSetting("enableCameraPanning", false);
    ids.forEach((id) => graph.setNodeAttribute(id, "fixed", true));
    options.onStart(ids);
    payload.preventSigmaDefault?.();
    payload.event.preventSigmaDefault?.();
  }

  function drag(event: Pointer): void {
    const graph = options.getGraph();
    const sigma = options.getSigma();
    if (!origin || !graph || !sigma) return;
    const point = sigma.viewportToGraph(event);
    const delta = { x: point.x - origin.x, y: point.y - origin.y };
    if (!delta.x && !delta.y) return;
    const positions = options.translate(members, delta);
    positions.forEach((position, id) => graph.mergeNodeAttributes(id, position));
    options.onMoved(positions);
    moved = true;
    options.suppressViewChangesFor(250);
    event.preventSigmaDefault?.();
    sigma.refresh();
  }

  function end(): void {
    if (moved) options.suppressNodeClicksFor(250);
    reset();
    options.suppressViewChangesFor(250);
  }

  return {
    reset,
    bind: () => {
      const sigma = options.getSigma();
      sigma?.on("downNode", start);
      sigma?.getMouseCaptor?.()?.on?.("mousemovebody", drag);
      sigma?.getMouseCaptor?.()?.on?.("mouseup", end);
      window.addEventListener("blur", end);
    },
    unbind: () => {
      const sigma = options.getSigma();
      reset();
      sigma?.off("downNode", start);
      sigma?.getMouseCaptor?.()?.off?.("mousemovebody", drag);
      sigma?.getMouseCaptor?.()?.off?.("mouseup", end);
      window.removeEventListener("blur", end);
    },
  };
}

export function resolveDragMembers(
  graph: Graph,
  grabbed: string,
  selection: DragSelection,
): { nodeIds: string[]; error?: string } {
  if (!graph.hasNode(grabbed)) return { nodeIds: [], error: "This node is no longer loaded." };
  switch (selection.kind) {
    case "node":
      return { nodeIds: [grabbed] };
    case "group":
      return selection.nodeIds.includes(grabbed)
        ? { nodeIds: [...new Set(selection.nodeIds)].filter((id) => graph.hasNode(id)) }
        : { nodeIds: [], error: "Drag a member of the selected group, or switch to direct dragging." };
    case "branch": {
      if (!graph.hasNode(selection.rootId))
        return {
          nodeIds: [],
          error: "The arrangement root is not loaded. Choose a visible root or use direct dragging.",
        };
      const parent = new Map<string, string | null>([[selection.rootId, null]]);
      const queue = [selection.rootId];
      for (let i = 0; i < queue.length; i++) {
        const id = queue[i];
        for (const neighbor of graph.neighbors(id)) {
          if (neighbor === parent.get(id)) continue;
          if (parent.has(neighbor))
            return { nodeIds: [], error: "This component contains a cycle; choose a group or use direct dragging." };
          parent.set(neighbor, id);
          queue.push(neighbor);
        }
      }
      if (!parent.has(grabbed)) return { nodeIds: [], error: "This node is disconnected from the arrangement root." };
      const selected = new Set([grabbed]);
      for (const id of queue) if (selected.has(parent.get(id) ?? "")) selected.add(id);
      return { nodeIds: [...selected] };
    }
  }
}
