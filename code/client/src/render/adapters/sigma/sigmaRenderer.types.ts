import type { GraphDisplayOptions } from '../../renderer.types';
import type { SigmaForceMotionOptions } from './motion/sigmaForceMotion';

export type SigmaPiechartOptions = {
    readonly enabled?: boolean;
    readonly palette?: readonly string[];
};

export type SigmaRendererOptions = {
    readonly piechart?: SigmaPiechartOptions;
    readonly forceMotion?: SigmaForceMotionOptions;
    readonly display?: GraphDisplayOptions;
    readonly label?: {
        readonly enabled?: boolean;
        readonly color?: string;
        readonly size?: number;
        readonly density?: number;
        readonly gridCellSize?: number;
        readonly renderedSizeThreshold?: number;
    };
    readonly edge?: {
        readonly size?: number;
        readonly color?: string;
        readonly labelColor?: string;
        readonly labelSize?: number;
    };
};

export type SigmaNodeProgramClasses = Record<string, unknown>;
