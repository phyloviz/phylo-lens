import { createNodePiechartProgram } from "@sigma/node-piechart";
import type { PositionedGraph } from "../../../contracts/positioned";
import {
  buildPiePalette,
  PIE_CATEGORY_COLORS_ATTRIBUTE,
  PIE_OTHER_SLICE_COLOR,
  PIE_OTHER_SLICE_KEY,
  PIE_PALETTE_ATTRIBUTE,
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

  const runtimePalette = resolvePaletteFromGraph(graph);
  const runtimeCategoryColors = resolvePieCategoryColorsFromGraph(graph);
  const palette = buildPiePalette(
    sliceKeys.length,
    runtimePalette ?? options.palette,
  );
  const slices = sliceKeys.map((attributeKey, index) => ({
    color: {
      value:
        attributeKey === PIE_OTHER_SLICE_KEY
          ? PIE_OTHER_SLICE_COLOR
          : runtimeCategoryColors[attributeKey] ?? (palette[index] as string),
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

function resolvePaletteFromGraph(
  graph: PositionedGraph | undefined,
): string[] | undefined {
  if (!graph) {
    return undefined;
  }

  for (const node of graph.nodes) {
    const paletteValue = node.attributes?.[PIE_PALETTE_ATTRIBUTE];
    if (!Array.isArray(paletteValue)) {
      continue;
    }

    const colors = paletteValue.filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    );
    if (colors.length > 0) {
      return colors;
    }
  }

  return undefined;
}

function resolvePieCategoryColorsFromGraph(
  graph: PositionedGraph | undefined,
): Record<string, string> {
  if (!graph) {
    return {};
  }

  for (const node of graph.nodes) {
    const colorValue = node.attributes?.[PIE_CATEGORY_COLORS_ATTRIBUTE];
    if (!colorValue || typeof colorValue !== "object" || Array.isArray(colorValue)) {
      continue;
    }

    return colorValue as Record<string, string>;
  }

  return {};
}

export function buildPieProgramSignature(
  sliceKeys: readonly string[],
  graph: PositionedGraph | undefined,
): string {
  const categoryColors = resolvePieCategoryColorsFromGraph(graph);
  return sliceKeys
    .map((key) => {
      const color =
        key === PIE_OTHER_SLICE_KEY
          ? PIE_OTHER_SLICE_COLOR
          : categoryColors[key] ?? "";
      return `${key}:${color}`;
    })
    .join("|");
}
