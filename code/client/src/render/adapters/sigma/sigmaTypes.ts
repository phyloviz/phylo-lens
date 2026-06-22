import type { GraphDisplayOptions } from "../../types";
import type { SigmaForceMotionOptions } from "./sigmaForceMotion";

export interface SigmaPiechartOptions {
  enabled?: boolean;
  palette?: string[];
}

export interface SigmaRendererOptions {
  piechart?: SigmaPiechartOptions;
  forceMotion?: SigmaForceMotionOptions;
  display?: GraphDisplayOptions;
  label?: {
    enabled?: boolean;
    color?: string;
    size?: number;
    density?: number;
    gridCellSize?: number;
    renderedSizeThreshold?: number;
  };
  edge?: {
    size?: number;
    color?: string;
    labelColor?: string;
    labelSize?: number;
  };
}

export type SigmaNodeProgramClasses = Record<string, unknown>;
