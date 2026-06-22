import { createNodePiechartProgram } from "@sigma/node-piechart";
import type { PositionedGraph } from "../../../contracts/positioned";
import {
  resolvePieSliceColors,
} from "../../pieMapping";
import {
  SIGMA_DEFAULT_NODE_COLOR,
  SIGMA_NODE_TYPE_PIECHART,
} from "./sigmaRenderingConstants";
import type {
  SigmaNodeProgramClasses,
  SigmaPiechartOptions,
} from "./sigmaTypes";

export function piechartProgramClasses(
  sliceKeys: readonly string[],
  graph: PositionedGraph | undefined,
  options: SigmaPiechartOptions,
): SigmaNodeProgramClasses {
  if (sliceKeys.length === 0) {
    return {};
  }

  const colors = resolvePieSliceColors(
    graph?.nodes ?? [],
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
      defaultColor: SIGMA_DEFAULT_NODE_COLOR,
      slices,
    }),
  };
}

export function buildPieProgramSignature(
  sliceKeys: readonly string[],
  graph: PositionedGraph | undefined,
): string {
  const colors = resolvePieSliceColors(graph?.nodes ?? [], sliceKeys);
  return sliceKeys
    .map((key) => `${key}:${colors[key] ?? ""}`)
    .join("|");
}
