export const ERR_NO_RENDER_CANVAS = "No rendered canvas is available to export.";
export const ERR_PNG_ENCODING_FAILED = "The rendered view could not be encoded as PNG.";

/**
 * Composite the canvases that make up one renderer view in DOM paint order.
 * Sigma uses separate canvas layers (for example WebGL, labels, and hover
 * overlays), so serializing only the first canvas would omit visible content.
 */
export async function exportCanvasLayersAsPng(
  canvases: Iterable<HTMLCanvasElement>,
  documentRef: Document = document,
): Promise<Blob> {
  const layers = Array.from(canvases).filter((canvas) => canvas.width > 0 && canvas.height > 0);
  const source = layers[0];
  if (!source) {
    throw new Error(ERR_NO_RENDER_CANVAS);
  }

  const output = documentRef.createElement("canvas");
  output.width = source.width;
  output.height = source.height;
  const context = output.getContext("2d");
  if (!context) {
    throw new Error(ERR_PNG_ENCODING_FAILED);
  }

  for (const layer of layers) {
    context.drawImage(layer, 0, 0, output.width, output.height);
  }

  return canvasToPngBlob(output);
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
      } else {
        reject(new Error(ERR_PNG_ENCODING_FAILED));
      }
    }, "image/png");
  });
}
