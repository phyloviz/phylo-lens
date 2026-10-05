import type { GraphLayoutBounds } from './graph/viewport/GraphLayoutBounds';
import type { AncillaryObservation, Isolate, NodeAnnotations } from './ancillary';
export const LAYOUT_FORCE = 'force';
export const LAYOUT_RADIAL = 'radial';
export const LAYOUT_DENDROGRAM = 'dendrogram';
export const LAYOUT_SERVER = 'server';

export type LayoutMode = typeof LAYOUT_FORCE | typeof LAYOUT_RADIAL | typeof LAYOUT_DENDROGRAM | typeof LAYOUT_SERVER;

/** Known ancillary values stay typed; hosts may supply other readonly attributes. */
export type GraphNodeAttributes = Readonly<Record<string, unknown>> & {
    readonly annotations?: NodeAnnotations;
    readonly isolates?: readonly Isolate[];
    readonly ancillaryDistribution?: readonly AncillaryObservation[];
};

export type PositionedNode = {
    readonly id: string;
    readonly x: number;
    readonly y: number;
    readonly size?: number;
    readonly color?: string;
    readonly attributes?: GraphNodeAttributes;
};

export type PositionedEdge = {
    readonly id: string;
    readonly source: string;
    readonly target: string;
    readonly attributes?: Readonly<Record<string, unknown>>;
};

export type PositionedGraph = {
    readonly nodes: readonly PositionedNode[];
    readonly edges: readonly PositionedEdge[];
    readonly viewMeta: {
        readonly layout: LayoutMode;
        readonly lodLevel: number;
        readonly lodTierCount?: number;
        readonly sliceNodeCount?: number;
        readonly sliceEdgeCount?: number;
        readonly zoom?: number;
        readonly globalBounds?: GraphLayoutBounds;
        readonly layoutStatus?: string;
        readonly layoutWarnings?: readonly string[];
    };
};
