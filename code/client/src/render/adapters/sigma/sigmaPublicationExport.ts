import type Graph from "graphology";
import Sigma from "sigma";
import type { PositionedGraph } from "../../../contracts/positioned";
import type { PngExportOptions } from "../../renderer.types";
import type { SigmaRendererOptions } from "./sigmaRenderer.types";
import { buildSigmaSettings } from "./sigmaRenderer.settings";
import { piechartProgramClasses } from "./programs/sigmaPiePrograms";
import { detectPieSliceKeys } from "../../mapping/pieMapping";
import { formatDistanceLabel } from "./attributes/sigmaLabels";
import { buildAncillaryWheelStats } from "../../../components/ancillaryWheel";
import { exportCanvasLayersAsPng } from "../../export/canvasExport";

/** A separate renderer provides real high-resolution labels without resizing the live view. */
export async function exportSigmaPublication(
  live: Sigma,
  graph: Graph,
  snapshot: PositionedGraph,
  rendererOptions: SigmaRendererOptions,
  options: PngExportOptions,
): Promise<Blob> {
  const scale = options.scale ?? 2;
  const labelSize = options.edgeLabelSize ?? 12;
  if (
    !Number.isFinite(scale) ||
    scale < 1 ||
    scale > 4 ||
    !Number.isFinite(labelSize) ||
    labelSize < 6 ||
    labelSize > 72
  )
    throw new Error("Export scale must be 1–4 and distance label size must be 6–72 pixels.");
  const dimensions = live.getDimensions();
  const width = Math.round(dimensions.width * scale);
  const height = Math.round(dimensions.height * scale);
  if (!width || !height || width * height > 32_000_000)
    throw new Error("Export must have nonzero dimensions and at most 32 million graph pixels.");
  const labelsEnabled =
    options.edgeLabels === "all" || (options.edgeLabels !== "none" && live.getSetting("renderEdgeLabels"));
  const selected = options.edgeIds ? new Set(options.edgeIds) : null;
  const copy = graph.copy();
  copy.forEachNode((id, attributes) => copy.setNodeAttribute(id, "size", (attributes.size ?? 3) * scale));
  copy.forEachEdge((id, attributes) => {
    const label = labelsEnabled && (!selected || selected.has(id)) ? formatDistanceLabel(attributes.distance) : "";
    copy.mergeEdgeAttributes(id, { size: (attributes.size ?? 1) * scale, label, forceLabel: Boolean(label) });
  });
  const container = document.createElement("div");
  Object.assign(container.style, {
    position: "fixed",
    left: "-100000px",
    top: "0",
    width: `${width}px`,
    height: `${height}px`,
  });
  container.setAttribute("aria-hidden", "true");
  document.body.append(container);
  let renderer: Sigma | undefined;
  try {
    const settings = buildSigmaSettings(
      rendererOptions,
      piechartProgramClasses(detectPieSliceKeys(snapshot.nodes), snapshot.nodes, rendererOptions.piechart ?? {}),
    );
    renderer = new Sigma(copy, container, {
      ...settings,
      renderEdgeLabels: labelsEnabled,
      edgeLabelSize: labelSize * scale,
      labelSize: (live.getSetting("labelSize") as number) * scale,
      labelGridCellSize: (live.getSetting("labelGridCellSize") as number) * scale,
      stagePadding: (live.getSetting("stagePadding") as number) * scale,
      minEdgeThickness: (live.getSetting("minEdgeThickness") as number) * scale,
    });
    renderer.setCustomBBox(live.getCustomBBox());
    renderer.getCamera().setState(live.getCamera().getState());
    renderer.refresh();
    const legend =
      options.includeLegend === false
        ? undefined
        : buildAncillaryWheelStats(snapshot, { palette: rendererOptions.piechart?.palette })?.slices;
    return await exportCanvasLayersAsPng(container.querySelectorAll("canvas"), document, {
      width,
      height,
      scale,
      legend,
    });
  } finally {
    renderer?.kill();
    container.remove();
  }
}
