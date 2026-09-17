export const ERR_NO_RENDER_CANVAS = "No rendered canvas is available to export.";
export const ERR_PNG_ENCODING_FAILED = "The rendered view could not be encoded as PNG.";

type LegendItem = { label: string; color: string; value: number };

/** Composite all renderer layers in paint order; publication options add a white background and legend. */
export async function exportCanvasLayersAsPng(
  canvases: Iterable<HTMLCanvasElement>,
  documentRef: Document = document,
  options?: { width: number; height: number; scale?: number; legend?: LegendItem[] },
): Promise<Blob> {
  const layers = Array.from(canvases).filter((canvas) => canvas.width > 0 && canvas.height > 0);
  const source = layers[0];
  if (!source) throw new Error(ERR_NO_RENDER_CANVAS);
  const output = documentRef.createElement("canvas");
  output.width = options?.width ?? source.width;
  const context = output.getContext("2d");
  if (!context) throw new Error(ERR_PNG_ENCODING_FAILED);
  const scale = options?.scale ?? 1;
  const padding = 16 * scale;
  const rowHeight = 22 * scale;
  const font = `${12 * scale}px sans-serif`;
  context.font = font;
  const rows = (options?.legend ?? []).flatMap((item) =>
    wrapText(context, `${item.label} · n = ${item.value}`, Math.max(1, output.width - padding * 3)).map(
      (text, index) => ({ text, color: index === 0 ? item.color : undefined }),
    ),
  );
  const graphHeight = options?.height ?? source.height;
  output.height = graphHeight + (rows.length ? padding * 2 + rowHeight * (rows.length + 1) : 0);
  if (options && output.width * output.height > 32_000_000)
    throw new Error("PNG including its legend exceeds 32 million pixels; reduce the export scale.");
  if (options) {
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, output.width, output.height);
  }
  for (const layer of layers) context.drawImage(layer, 0, 0, output.width, graphHeight);
  if (rows.length) {
    context.font = font;
    context.textBaseline = "middle";
    context.fillStyle = "#0f172a";
    context.fillText("Rendered slice — observations", padding, graphHeight + padding + rowHeight / 2);
    rows.forEach((row, index) => {
      const y = graphHeight + padding + rowHeight * (index + 1.5);
      if (row.color) {
        context.fillStyle = row.color;
        context.fillRect(padding, y - 5 * scale, 10 * scale, 10 * scale);
      }
      context.fillStyle = "#0f172a";
      context.fillText(row.text, padding * 2, y);
    });
  }
  return new Promise((resolve, reject) => {
    output.toBlob((blob) => (blob ? resolve(blob) : reject(new Error(ERR_PNG_ENCODING_FAILED))), "image/png");
  });
}

// Wrap rather than shrink long category labels, including unbroken identifiers.
function wrapText(context: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const character of text) {
    if (line && context.measureText(line + character).width > width) {
      lines.push(line);
      line = "";
    }
    line += character;
  }
  if (line) lines.push(line);
  return lines;
}
