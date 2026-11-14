import { vi } from 'vitest';
import type { PositionedGraph } from '../../src/contracts/positioned';
import type {
  GraphRenderer,
  RenderNodeClickState,
  RenderViewportRequestState,
  RenderViewportState,
} from '../../src/render/renderer.types';

export function recordingRenderer(
  viewportState: RenderViewportRequestState = {
    bounds: { xmin: -10, xmax: 10, ymin: -20, ymax: 20 },
    cameraRatio: 1,
  }
) {
  let viewHandler: ((state: RenderViewportState) => void) | null = null;
  let manipulationHandler: ((active: boolean) => void) | null = null;
  let clickHandler: ((state: RenderNodeClickState) => void) | null = null;
  const renderer = {
    viewportState,
    appliedGraphs: [] as PositionedGraph[],
    mount: vi.fn(),
    unmount: vi.fn(() => {
      viewHandler = null;
      manipulationHandler = null;
      clickHandler = null;
    }),
    render: vi.fn(),
    focusNode: vi.fn(),
    getViewportState: vi.fn((): RenderViewportRequestState => renderer.viewportState),
    applyGraphSnapshot: vi.fn((graph: PositionedGraph): void => {
      renderer.appliedGraphs.push(graph);
    }),
    fitGraphSnapshot: vi.fn(() => null),
    updateDisplayOptions: vi.fn(),
    setViewChangeHandler: vi.fn((handler: typeof viewHandler) => {
      viewHandler = handler;
    }),
    setManipulationHandler: vi.fn((handler: typeof manipulationHandler) => {
      manipulationHandler = handler;
    }),
    setNodeClickHandler: vi.fn((handler: typeof clickHandler) => {
      clickHandler = handler;
    }),
    setNodeDoubleClickHandler: vi.fn<NonNullable<GraphRenderer['setNodeDoubleClickHandler']>>(),
    emitViewChange: () => viewHandler?.({ viewport: { x: 0, y: 0, width: 1, height: 1 }, zoom: 1 }),
    emitManipulation: (active: boolean) => manipulationHandler?.(active),
    emitNodeClick: (state: RenderNodeClickState) => clickHandler?.(state),
  } satisfies GraphRenderer & {
    viewportState: RenderViewportRequestState;
    appliedGraphs: PositionedGraph[];
    emitViewChange: () => void;
    emitManipulation: (active: boolean) => void;
    emitNodeClick: (state: RenderNodeClickState) => void;
  };
  return renderer as typeof renderer & GraphRenderer;
}
