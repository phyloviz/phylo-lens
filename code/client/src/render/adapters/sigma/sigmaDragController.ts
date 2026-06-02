import type Graph from "graphology";
import type Sigma from "sigma";

type MouseEventPayload = {
  x: number;
  y: number;
  preventSigmaDefault?: () => void;
};

type SigmaNodeEventPayload = {
  node?: string;
  event?: MouseEventPayload;
  preventSigmaDefault?: () => void;
};

type SigmaEventTarget = {
  on?: (event: string, handler: (payload: SigmaNodeEventPayload) => void) => void;
  off?: (
    event: string,
    handler: (payload: SigmaNodeEventPayload) => void,
  ) => void;
};

type SigmaMouseCaptor = {
  on?: (event: string, handler: (payload: MouseEventPayload) => void) => void;
  off?: (event: string, handler: (payload: MouseEventPayload) => void) => void;
};

type Point = {
  x: number;
  y: number;
};

type MotionNode = {
  home: Point;
  velocity: Point;
  targetOffset: Point;
};

interface SigmaDragControllerOptions {
  getGraph: () => Graph | null;
  getSigma: () => Sigma | null;
  suppressViewChangesFor: (durationMs: number) => void;
  suppressNodeClicksFor: (durationMs: number) => void;
}

const REPULSION_RADIUS_PX = 120;
const REPULSION_STRENGTH_PX = 72;
const SPRING_STRENGTH = 0.22;
const VELOCITY_DAMPING = 0.68;
const REST_THRESHOLD = 0.01;

export class SigmaDragController {
  private readonly options: SigmaDragControllerOptions;
  private draggedNodeId: string | null = null;
  private draggedNodeMoved = false;
  private previousCameraPanningEnabled: boolean | null = null;
  private animationFrameId: number | null = null;
  private readonly motionNodes = new Map<string, MotionNode>();
  private readonly boundNodeDragStarted = (payload: SigmaNodeEventPayload) => {
    this.startNodeDrag(payload);
  };
  private readonly boundNodeDragged = (payload: MouseEventPayload) => {
    this.dragNode(payload);
  };
  private readonly boundNodeDragEnded = () => {
    this.endNodeDrag();
  };

  constructor(options: SigmaDragControllerOptions) {
    this.options = options;
  }

  bind(): void {
    const sigma = this.options.getSigma() as SigmaEventTarget | null;
    const mouseCaptor = this.options.getSigma()?.getMouseCaptor?.() as
      | SigmaMouseCaptor
      | undefined;

    sigma?.off?.("downNode", this.boundNodeDragStarted);
    sigma?.on?.("downNode", this.boundNodeDragStarted);
    mouseCaptor?.off?.("mousemovebody", this.boundNodeDragged);
    mouseCaptor?.on?.("mousemovebody", this.boundNodeDragged);
    mouseCaptor?.off?.("mouseup", this.boundNodeDragEnded);
    mouseCaptor?.on?.("mouseup", this.boundNodeDragEnded);
  }

  unbind(): void {
    const sigma = this.options.getSigma() as SigmaEventTarget | null;
    const mouseCaptor = this.options.getSigma()?.getMouseCaptor?.() as
      | SigmaMouseCaptor
      | undefined;

    sigma?.off?.("downNode", this.boundNodeDragStarted);
    mouseCaptor?.off?.("mousemovebody", this.boundNodeDragged);
    mouseCaptor?.off?.("mouseup", this.boundNodeDragEnded);
  }

  reset(): void {
    this.draggedNodeId = null;
    this.draggedNodeMoved = false;
    this.previousCameraPanningEnabled = null;
    this.releaseMotionNodes();
  }

  private startNodeDrag(payload: SigmaNodeEventPayload): void {
    const graph = this.options.getGraph();
    const sigma = this.options.getSigma();
    const nodeId = payload.node;

    if (!nodeId || !graph?.hasNode(nodeId) || !sigma) {
      return;
    }

    this.draggedNodeId = nodeId;
    this.draggedNodeMoved = false;
    this.options.suppressViewChangesFor(250);
    this.previousCameraPanningEnabled = sigma.getSetting?.(
      "enableCameraPanning",
    ) as boolean | null;
    sigma.setSetting?.("enableCameraPanning", false);
    payload.preventSigmaDefault?.();
    payload.event?.preventSigmaDefault?.();
  }

  private dragNode(payload: MouseEventPayload): void {
    const graph = this.options.getGraph();
    const sigma = this.options.getSigma();

    if (!this.draggedNodeId || !graph || !sigma) {
      return;
    }

    const position = sigma.viewportToGraph({
      x: payload.x,
      y: payload.y,
    });

    graph.setNodeAttribute(this.draggedNodeId, "x", position.x);
    graph.setNodeAttribute(this.draggedNodeId, "y", position.y);
    this.repelNearbyNodes(payload);
    this.draggedNodeMoved = true;
    this.options.suppressViewChangesFor(250);
    payload.preventSigmaDefault?.();
    sigma.refresh({
      partialGraph: { nodes: [this.draggedNodeId] },
      skipIndexation: false,
    });
  }

  private endNodeDrag(): void {
    const sigma = this.options.getSigma();

    if (!sigma || !this.draggedNodeId) {
      return;
    }

    if (typeof this.previousCameraPanningEnabled === "boolean") {
      sigma.setSetting?.("enableCameraPanning", this.previousCameraPanningEnabled);
    }

    if (this.draggedNodeMoved) {
      this.options.suppressNodeClicksFor(250);
    }

    this.reset();
    this.options.suppressViewChangesFor(250);
  }

  private repelNearbyNodes(dragPoint: Point): void {
    const graph = this.options.getGraph();
    const sigma = this.options.getSigma();

    if (!graph || !sigma || !this.draggedNodeId) {
      return;
    }

    this.clearRepulsionTargets();
    graph.forEachNode((nodeId) => {
      if (nodeId === this.draggedNodeId) {
        return;
      }

      const home = this.getStableNodePosition(graph, nodeId);
      if (!home) {
        return;
      }

      const viewportPosition = sigma.graphToViewport(home);
      const distance = distanceBetween(viewportPosition, dragPoint);
      if (distance >= REPULSION_RADIUS_PX) {
        return;
      }

      const direction = directionAwayFromDrag(nodeId, viewportPosition, dragPoint);
      const pushDistance = computeRepulsion(distance);
      const targetViewportPosition = {
        x: viewportPosition.x + direction.x * pushDistance,
        y: viewportPosition.y + direction.y * pushDistance,
      };
      const targetGraphPosition = sigma.viewportToGraph(targetViewportPosition);
      const motionNode = this.ensureMotionNode(nodeId, home);

      motionNode.targetOffset = {
        x: targetGraphPosition.x - motionNode.home.x,
        y: targetGraphPosition.y - motionNode.home.y,
      };
    });

    this.scheduleMotion();
  }

  private clearRepulsionTargets(): void {
    this.motionNodes.forEach((motionNode) => {
      motionNode.targetOffset = { x: 0, y: 0 };
    });
  }

  private getStableNodePosition(graph: Graph, nodeId: string): Point | null {
    const existingMotion = this.motionNodes.get(nodeId);
    if (existingMotion) {
      return existingMotion.home;
    }

    const x = graph.getNodeAttribute(nodeId, "x");
    const y = graph.getNodeAttribute(nodeId, "y");
    if (!isFiniteNumber(x) || !isFiniteNumber(y)) {
      return null;
    }

    return { x, y };
  }

  private ensureMotionNode(nodeId: string, home: Point): MotionNode {
    const existingMotion = this.motionNodes.get(nodeId);
    if (existingMotion) {
      return existingMotion;
    }

    const motionNode = {
      home,
      velocity: { x: 0, y: 0 },
      targetOffset: { x: 0, y: 0 },
    };
    this.motionNodes.set(nodeId, motionNode);
    return motionNode;
  }

  private scheduleMotion(): void {
    if (this.animationFrameId !== null) {
      return;
    }

    this.animationFrameId = window.requestAnimationFrame(() => {
      this.animationFrameId = null;
      this.animateMotionNodes();
    });
  }

  private animateMotionNodes(): void {
    const graph = this.options.getGraph();
    const sigma = this.options.getSigma();

    if (!graph || !sigma) {
      this.motionNodes.clear();
      return;
    }

    const movedNodeIds: string[] = [];
    this.motionNodes.forEach((motionNode, nodeId) => {
      if (!graph.hasNode(nodeId)) {
        this.motionNodes.delete(nodeId);
        return;
      }

      const currentPosition = this.getCurrentNodePosition(graph, nodeId);
      if (!currentPosition) {
        this.motionNodes.delete(nodeId);
        return;
      }

      const targetPosition = {
        x: motionNode.home.x + motionNode.targetOffset.x,
        y: motionNode.home.y + motionNode.targetOffset.y,
      };
      const nextVelocity = computeSpringVelocity(
        currentPosition,
        targetPosition,
        motionNode.velocity,
      );
      const nextPosition = {
        x: currentPosition.x + nextVelocity.x,
        y: currentPosition.y + nextVelocity.y,
      };

      motionNode.velocity = nextVelocity;
      graph.setNodeAttribute(nodeId, "x", nextPosition.x);
      graph.setNodeAttribute(nodeId, "y", nextPosition.y);
      movedNodeIds.push(nodeId);

      if (this.hasComeToRest(motionNode, nextPosition)) {
        graph.setNodeAttribute(nodeId, "x", motionNode.home.x);
        graph.setNodeAttribute(nodeId, "y", motionNode.home.y);
        this.motionNodes.delete(nodeId);
      }
    });

    if (movedNodeIds.length > 0) {
      sigma.refresh({
        partialGraph: { nodes: movedNodeIds },
        skipIndexation: false,
      });
    }

    if (this.motionNodes.size > 0) {
      this.scheduleMotion();
    }
  }

  private getCurrentNodePosition(graph: Graph, nodeId: string): Point | null {
    const x = graph.getNodeAttribute(nodeId, "x");
    const y = graph.getNodeAttribute(nodeId, "y");
    if (!isFiniteNumber(x) || !isFiniteNumber(y)) {
      return null;
    }

    return { x, y };
  }

  private hasComeToRest(motionNode: MotionNode, position: Point): boolean {
    if (this.draggedNodeId !== null) {
      return false;
    }

    const homeDistance = distanceBetween(position, motionNode.home);
    const speed = distanceBetween(motionNode.velocity, { x: 0, y: 0 });
    return homeDistance < REST_THRESHOLD && speed < REST_THRESHOLD;
  }

  private releaseMotionNodes(): void {
    this.clearRepulsionTargets();
    if (this.motionNodes.size > 0) {
      this.scheduleMotion();
    }
  }
}

function computeRepulsion(distance: number): number {
  const closeness = 1 - distance / REPULSION_RADIUS_PX;
  return REPULSION_STRENGTH_PX * closeness * closeness;
}

function computeSpringVelocity(
  currentPosition: Point,
  targetPosition: Point,
  currentVelocity: Point,
): Point {
  return {
    x:
      (currentVelocity.x + (targetPosition.x - currentPosition.x) * SPRING_STRENGTH) *
      VELOCITY_DAMPING,
    y:
      (currentVelocity.y + (targetPosition.y - currentPosition.y) * SPRING_STRENGTH) *
      VELOCITY_DAMPING,
  };
}

function directionAwayFromDrag(
  nodeId: string,
  nodePosition: Point,
  dragPoint: Point,
): Point {
  const delta = {
    x: nodePosition.x - dragPoint.x,
    y: nodePosition.y - dragPoint.y,
  };
  const distance = distanceBetween(nodePosition, dragPoint);

  if (distance > 0.001) {
    return {
      x: delta.x / distance,
      y: delta.y / distance,
    };
  }

  return stableDirectionFromNodeId(nodeId);
}

function stableDirectionFromNodeId(nodeId: string): Point {
  let hash = 0;
  for (let index = 0; index < nodeId.length; index += 1) {
    hash = (hash * 31 + nodeId.charCodeAt(index)) >>> 0;
  }

  const angle = (hash / 0xffffffff) * Math.PI * 2;
  return {
    x: Math.cos(angle),
    y: Math.sin(angle),
  };
}

function distanceBetween(left: Point, right: Point): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
