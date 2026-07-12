import { createNodePiechartProgram } from "@sigma/node-piechart";
import { resolvePieSliceColors } from "../../../mapping/pieMapping";
import { PHYLOVIZ_NODE_COMMON_COLOR, SIGMA_NODE_TYPE_PIECHART } from "../sigmaRendering.constants";
import type { SigmaNodeProgramClasses, SigmaPiechartOptions } from "../sigmaRenderer.types";

// Minimal node shape shared by the legacy render path (PositionedNode) and the
// LoD sync path (graphology node attribute views) for pie-program resolution.
export type PieNodeView = { attributes?: Record<string, unknown> };

export function piechartProgramClasses(
  sliceKeys: readonly string[],
  nodes: readonly PieNodeView[],
  options: SigmaPiechartOptions,
): SigmaNodeProgramClasses {
  if (sliceKeys.length === 0) {
    return {};
  }

  const colors = resolvePieSliceColors(
    nodes as Array<{ attributes?: Record<string, unknown> }>,
    sliceKeys,
    options.palette,
  );
  const slices = sliceKeys.map((attributeKey) => ({
    color: {
      value: colors[attributeKey] as string,
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
  const colors = resolvePieSliceColors(nodes as Array<{ attributes?: Record<string, unknown> }>, sliceKeys);
  return sliceKeys.map((key) => `${key}:${colors[key] ?? ""}`).join("|");
}
