import type { AncillaryFilterState } from "../../ancillary/ancillaryTypes";
import type { GraphViewportResult } from "../../contracts/graph/viewport/GraphViewportResult";
import type { PositionedGraph } from "../../contracts/positioned";
import type { GraphDisplayOptions } from "../../render/renderer.types";
import type { VisualMappingOptions } from "../../render/mapping/visualMapping";
import type { GraphSession } from "./graphWorkbench.types";

export const ACTIONS = {
  reset: "reset",
  lodRefreshPaused: "lodRefreshPaused",
  filtersUpdated: "filtersUpdated",
  visualMappingUpdated: "visualMappingUpdated",
  displayOptionsUpdated: "displayOptionsUpdated",
  graphPrepared: "graphPrepared",
  viewportApplied: "viewportApplied",
  graphCleared: "graphCleared",
} as const;

export type GraphWorkbenchAction =
  | {
      readonly type: typeof ACTIONS.reset;
    }
  | {
      readonly type: typeof ACTIONS.lodRefreshPaused;
      readonly paused: boolean;
    }
  | {
      readonly type: typeof ACTIONS.filtersUpdated;
      readonly filters: AncillaryFilterState;
    }
  | {
      readonly type: typeof ACTIONS.visualMappingUpdated;
      readonly visualMapping: VisualMappingOptions;
    }
  | {
      readonly type: typeof ACTIONS.displayOptionsUpdated;
      readonly displayOptions: GraphDisplayOptions;
    }
  | {
      readonly type: typeof ACTIONS.graphPrepared;
      readonly session: GraphSession;
    }
  | {
      readonly type: typeof ACTIONS.viewportApplied;
      readonly graph: PositionedGraph;
      readonly response?: GraphViewportResult;
    }
  | {
      readonly type: typeof ACTIONS.graphCleared;
    };
