import { createNodePiechartProgram } from '@sigma/node-piechart';
import { resolvePieSliceColors } from '../../../mapping/pieMapping';
import { PHYLOVIZ_NODE_COMMON_COLOR, SIGMA_NODE_TYPE_PIECHART } from '../sigmaRendering.constants';
import type { SigmaNodeProgramClasses, SigmaPiechartOptions } from '../sigmaRenderer.types';

export type PieNodeView = { readonly attributes?: Readonly<Record<string, unknown>> };

export function piechartProgramClasses(
    sliceKeys: readonly string[],
    nodes: readonly PieNodeView[],
    options: SigmaPiechartOptions
): SigmaNodeProgramClasses {
    if (sliceKeys.length === 0) {
        return {};
    }

    const colors = resolvePieSliceColors(nodes, sliceKeys, options.palette);
    const slices = sliceKeys.map(attributeKey => ({
        color: {
            value: colors[attributeKey],
        },
        value: { attribute: attributeKey },
    })) as [
        { color: { value: string }; value: { attribute: string } },
        ...Array<{ color: { value: string }; value: { attribute: string } }>,
    ];

    return {
        [SIGMA_NODE_TYPE_PIECHART]: createNodePiechartProgram({
            defaultColor: PHYLOVIZ_NODE_COMMON_COLOR,
            slices,
        }),
    };
}

export function buildPieProgramSignature(sliceKeys: readonly string[], nodes: readonly PieNodeView[]): string {
    const colors = resolvePieSliceColors(nodes, sliceKeys);
    return sliceKeys.map(key => `${key}:${colors[key] ?? ''}`).join('|');
}
