import type { PositionedGraph } from "../contracts/positioned";
import type {
  GraphV2Client,
  GraphV2ViewportResponse,
} from "../api/graphV2Client";
import type { ViewportSyncSettings } from "./adapters/sigma/graphViewerV2Sync";

export const RENDERER_KIND_SIGMA = "sigma";
export const RENDERER_KIND_MOCK = "mock";

export type RendererKind =
  | typeof RENDERER_KIND_SIGMA
  | typeof RENDERER_KIND_MOCK;

export interface RenderContext {
  containerId: string;
}

export interface RenderViewportState {
  viewport: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  zoom: number;
}

export interface RenderNodeClickState {
  nodeId: string;
  attributes?: Record<string, unknown>;
}

export interface GraphDisplayOptions {
  nodeLabels?: boolean;
  edgeDistanceLabels?: boolean;
  distanceWeightedEdges?: boolean;
}

export interface GraphRenderer {
  mount: (context: RenderContext) => void;
  unmount: () => void;
  render: (graph: PositionedGraph) => void;

  setViewChangeHandler?: (
    handler: ((state: RenderViewportState) => void) | null,
  ) => void;

  setNodeClickHandler?: (
    handler: ((state: RenderNodeClickState) => void) | null,
  ) => void;

  centerOnNode?: (nodeId: string) => void;

  focusNode?: (nodeId: string | null) => void;

  updateDisplayOptions?: (options: GraphDisplayOptions) => void;

  startGraphV2ViewportSync?: (options: {
    client: GraphV2Client;
    datasetId: string;
    layoutVersion?: string | null;
    maxNodes?: number;
    lodTierCount?: number;
    getPaused?: () => boolean;
    onViewportLoaded?: (response: GraphV2ViewportResponse) => void;
    onError?: (error: unknown) => void;
    getRenderSettings?: () => ViewportSyncSettings;
  }) => void;

  stopGraphV2ViewportSync?: () => void;

  refreshGraphV2ViewportSync?: () => void;
}

export interface RendererFactory {
  createRenderer(kind: RendererKind): GraphRenderer;
}
