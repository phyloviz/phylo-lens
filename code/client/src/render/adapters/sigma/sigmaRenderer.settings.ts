import { createNodeBorderProgram } from "@sigma/node-border";
import { TriangleNodeProgram } from "../../programs/triangleNodeProgram";
import { SIGMA_MAX_CAMERA_RATIO, SIGMA_MIN_CAMERA_RATIO, SIGMA_ZOOMING_RATIO } from "./camera/sigmaCamera";
import {
  SIGMA_DEFAULT_LABEL_COLOR,
  SIGMA_DEFAULT_LABEL_DENSITY,
  SIGMA_DEFAULT_LABEL_GRID_CELL_SIZE,
  SIGMA_DEFAULT_LABEL_RENDERED_SIZE_THRESHOLD,
  SIGMA_DEFAULT_LABEL_SIZE,
  SIGMA_NODE_TYPE_BORDER,
  SIGMA_NODE_TYPE_TRIANGLE,
} from "./sigmaRendering.constants";
import { drawCenteredNodeLabel, drawDistanceEdgeLabel } from "./attributes/sigmaLabels";
import type { SigmaNodeProgramClasses, SigmaRendererOptions } from "./sigmaRenderer.types";

export function buildSigmaSettings(
  rendererOptions: SigmaRendererOptions,
  nodeProgramClasses: SigmaNodeProgramClasses = {},
): Record<string, unknown> {
  const nodeLabelsEnabled = rendererOptions.display?.nodeLabels !== false;
  return {
    renderLabels: rendererOptions.label?.enabled !== false && nodeLabelsEnabled,
    renderEdgeLabels: false,
    minCameraRatio: SIGMA_MIN_CAMERA_RATIO,
    maxCameraRatio: SIGMA_MAX_CAMERA_RATIO,
    zoomingRatio: SIGMA_ZOOMING_RATIO,
    labelRenderedSizeThreshold:
      rendererOptions.label?.renderedSizeThreshold ?? SIGMA_DEFAULT_LABEL_RENDERED_SIZE_THRESHOLD,
    labelDensity: rendererOptions.label?.density ?? SIGMA_DEFAULT_LABEL_DENSITY,
    labelGridCellSize: rendererOptions.label?.gridCellSize ?? SIGMA_DEFAULT_LABEL_GRID_CELL_SIZE,
    labelColor: {
      color: rendererOptions.label?.color ?? SIGMA_DEFAULT_LABEL_COLOR,
    },
    labelSize: rendererOptions.label?.size ?? SIGMA_DEFAULT_LABEL_SIZE,
    edgeLabelColor: {
      color: rendererOptions.edge?.labelColor ?? SIGMA_DEFAULT_LABEL_COLOR,
    },
    edgeLabelSize: rendererOptions.edge?.labelSize ?? 11,
    defaultDrawEdgeLabel: drawDistanceEdgeLabel,
    defaultDrawNodeLabel: drawCenteredNodeLabel,
    nodeProgramClasses: {
      [SIGMA_NODE_TYPE_BORDER]: createNodeBorderProgram({
        drawLabel: drawCenteredNodeLabel,
        borders: [
          {
            size: { value: 4, mode: "pixels" },
            color: { attribute: "borderColor" },
          },
          {
            size: { fill: true },
            color: { attribute: "color" },
          },
        ],
      }),
      [SIGMA_NODE_TYPE_TRIANGLE]: TriangleNodeProgram,
      ...nodeProgramClasses,
    },
  };
}
